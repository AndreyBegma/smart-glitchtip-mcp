import createClient, { type Client } from 'openapi-fetch';
import { VERSION } from '../version';
import type { paths } from './generated/schema';
import {
  errorFromResponse,
  GlitchTipError,
  malformedResponseError,
  type Operation,
  timeoutError,
  unreachableError,
} from './glitchtip.errors';
import type { ResolvedInstance } from './instance.context';
import { type Page, parseNextCursor } from './pagination';

export type FetchLike = (request: Request) => Promise<Response>;
export type GlitchTipApi = Client<paths>;

export interface GlitchTipClientOptions {
  readonly timeoutMs: number;
  /** Injected for tests; defaults to the global fetch. */
  readonly fetch?: FetchLike;
  /** Injected for tests; defaults to setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; defaults to Math.random. */
  readonly random?: () => number;
}

/** What an openapi-fetch call resolves to, as far as this client cares. */
interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}
type ApiCall<T> = (api: GlitchTipApi) => Promise<ApiResult<T>>;

/** D-13: at most two retries, GET/HEAD only, never a mutation. */
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;
const RETRY_AFTER_CAP_S = 10;
const RETRYABLE_METHODS = new Set(['GET', 'HEAD']);

/**
 * The only way this server talks to GlitchTip (AGENTS.md rule 13).
 *
 * It owns the outbound policy: a timeout on every attempt, bounded retries of
 * safe methods on 429/5xx/network failure, the Authorization header, and the
 * mapping of every failure to a GlitchTipError whose message an agent can act
 * on. Callers describe the request with the generated, typed API and say
 * what they are doing; they never see a status code.
 */
export class GlitchTipClient {
  private readonly api: GlitchTipApi;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    private readonly instance: ResolvedInstance,
    private readonly options: GlitchTipClientOptions,
  ) {
    this.fetchImpl = options.fetch ?? ((request) => fetch(request));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.api = createClient<paths>({
      baseUrl: instance.url,
      fetch: (request) => this.send(request),
      headers: this.defaultHeaders(),
      redirect: 'manual',
    });
  }

  /** Performs one call and returns its body (undefined for 204). */
  async call<T>(operation: Operation, request: ApiCall<T>): Promise<T> {
    const result = await this.perform(operation, request);
    return result.data as T;
  }

  /** Performs one list call and returns the page with the cursor of the next. */
  async page<T>(operation: Operation, request: ApiCall<T[]>): Promise<Page<T>> {
    const result = await this.perform(operation, request);
    return {
      items: result.data ?? [],
      nextCursor: parseNextCursor(result.response.headers.get('link')),
    };
  }

  private async perform<T>(operation: Operation, request: ApiCall<T>): Promise<ApiResult<T>> {
    let result: ApiResult<T>;
    try {
      result = await request(this.api);
    } catch (error) {
      throw this.asGlitchTipError(error);
    }
    const { response } = result;
    if (response.ok) return result;
    throw this.redacted(
      errorFromResponse(
        response.status,
        result.error,
        operation,
        retryAfterSeconds(response.headers.get('retry-after')),
      ),
    );
  }

  /** The fetch openapi-fetch uses: timeout per attempt, retries for safe methods. */
  private async send(request: Request): Promise<Response> {
    const retryable = RETRYABLE_METHODS.has(request.method);
    for (let attempt = 0; ; attempt++) {
      const canRetry = retryable && attempt < MAX_RETRIES;
      let response: Response;
      try {
        response = await this.fetchImpl(
          new Request(request, { signal: AbortSignal.timeout(this.options.timeoutMs) }),
        );
      } catch (error) {
        if (isTimeout(error) || !canRetry) throw error;
        await this.sleep(this.backoff(attempt));
        continue;
      }
      if (!canRetry || !isRetryableStatus(response.status)) return response;
      discardBody(response);
      await this.sleep(this.retryDelay(response, attempt));
    }
  }

  private retryDelay(response: Response, attempt: number): number {
    const seconds = retryAfterSeconds(response.headers.get('retry-after'));
    return seconds === undefined ? this.backoff(attempt) : seconds * 1000;
  }

  /** 500 ms × 2^attempt, plus up to one base interval of jitter. */
  private backoff(attempt: number): number {
    return RETRY_BASE_MS * 2 ** attempt + Math.floor(this.random() * RETRY_BASE_MS);
  }

  private asGlitchTipError(error: unknown): GlitchTipError {
    if (error instanceof GlitchTipError) return this.redacted(error);
    if (isTimeout(error)) return timeoutError(this.options.timeoutMs);
    if (error instanceof SyntaxError) return malformedResponseError();
    return unreachableError(this.instance.origin);
  }

  private redacted(error: GlitchTipError): GlitchTipError {
    const message = this.instance.redact(error.message);
    const detail = error.detail === undefined ? undefined : this.instance.redact(error.detail);
    if (message === error.message && detail === error.detail) return error;
    return new GlitchTipError(error.kind, message, error.status, detail);
  }

  private defaultHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': `smart-glitchtip-mcp/${VERSION}`,
    };
    const authorization = this.instance.authorizationHeader();
    if (authorization) headers.authorization = authorization;
    return headers;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// Frees the connection of a response we will not read. Not awaited: a tee'd
// body only settles its cancel once every branch is cancelled.
function discardBody(response: Response): void {
  response.body?.cancel().catch(() => undefined);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

/** `Retry-After` as seconds (delta or HTTP date), capped at 10 s. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  let seconds: number;
  if (/^\d+$/.test(trimmed)) {
    seconds = Number(trimmed);
  } else {
    const date = Date.parse(trimmed);
    if (Number.isNaN(date)) return undefined;
    seconds = Math.max(0, Math.ceil((date - now) / 1000));
  }
  return Math.min(seconds, RETRY_AFTER_CAP_S);
}
