import createClient, { type Client } from 'openapi-fetch';
import { VERSION } from '../version';
import type { paths } from './generated/schema';
import {
  errorFromResponse,
  GlitchTipError,
  malformedListError,
  malformedResponseError,
  type Operation,
  refusedRequestError,
  timeoutError,
  unreachableError,
} from './glitchtip.errors';
import type { ResolvedInstance } from './instance.context';
import { type Page, parseNextCursor } from './pagination';
import {
  assertCallerHeaders,
  pathSegmentGuard,
  type RawQuery,
  rawMethod,
  rawRequestUrl,
} from './request-guards';

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

export interface CallOptions {
  /**
   * Replaces GLITCHTIP_TIMEOUT_MS for this call's attempts (100 ms – 600 s),
   * for the rare call that is legitimately slow, such as a large upload.
   */
  readonly timeoutMs?: number;
}

export interface RawRequestOptions extends CallOptions {
  readonly query?: RawQuery;
  /** FormData, a string or bytes go as they are; anything else is sent as JSON. */
  readonly body?: unknown;
  /** May not set Authorization, Host or Cookie. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** A raw call's answer, whatever its status; the body is text with the token scrubbed. */
export interface RawResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

/** D-13: at most two retries, GET/HEAD only, never a mutation. */
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;
const RETRY_AFTER_CAP_S = 10;
const RETRYABLE_METHODS = new Set(['GET', 'HEAD']);
/** The bounds of GLITCHTIP_TIMEOUT_MS, applied to a per-call override too. */
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 600_000;

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
    this.api = this.createApi(options.timeoutMs);
  }

  /** Performs one call and returns its body (undefined for 204). */
  async call<T>(operation: Operation, request: ApiCall<T>, options?: CallOptions): Promise<T> {
    const result = await this.perform(operation, request, options);
    return result.data as T;
  }

  /**
   * Performs one list call and returns the page, the cursor of the next and
   * the response headers. A 2xx body that is not an array is `malformed`,
   * never an empty page.
   */
  async page<T>(
    operation: Operation,
    request: ApiCall<T[]>,
    options?: CallOptions,
  ): Promise<Page<T>> {
    const result = await this.perform(operation, request, options);
    if (!Array.isArray(result.data)) throw malformedListError(operation);
    const headers = this.redactedHeaders(result.response.headers);
    return { items: result.data, nextCursor: parseNextCursor(headers.get('link')), headers };
  }

  /**
   * A call to a path the typed snapshot does not describe (the `api_request`
   * escape hatch). Same outbound policy as every call — timeout per attempt,
   * retries for GET/HEAD only, no redirects followed, the Authorization
   * header — and the URL must stay under the instance's `/api/`. Any HTTP
   * status is returned, not mapped (map it with `errorFromResponse`); only a
   * refused request or a transport failure throws. The body is not parsed.
   */
  async raw(
    operation: Operation,
    method: string,
    path: string,
    options: RawRequestOptions = {},
  ): Promise<RawResponse> {
    const timeoutMs = this.timeoutFor(options);
    // Everything below may come from an agent (the api_request toolset), so
    // each input is checked here and refused as `invalid` — never left to
    // throw a TypeError that would read as a malformed GlitchTip response.
    const verb = rawMethod(method, options.body !== undefined);
    const url = rawRequestUrl(this.instance.url, operation, path, options.query);
    assertCallerHeaders(options.headers ?? {});
    const request = buildRawRequest(url, verb, this.defaultHeaders(), options);
    try {
      const response = await this.send(request, timeoutMs);
      const text = this.instance.redact(await response.text());
      return { status: response.status, headers: this.redactedHeaders(response.headers), text };
    } catch (error) {
      throw this.asGlitchTipError(error, timeoutMs);
    }
  }

  /** A copy of response headers with the token removed from every value. */
  private redactedHeaders(headers: Headers): Headers {
    const copy = new Headers();
    for (const [name, value] of headers) copy.append(name, this.instance.redact(value));
    return copy;
  }

  private async perform<T>(
    operation: Operation,
    request: ApiCall<T>,
    options: CallOptions = {},
  ): Promise<ApiResult<T>> {
    const timeoutMs = this.timeoutFor(options);
    const api = timeoutMs === this.options.timeoutMs ? this.api : this.createApi(timeoutMs);
    let result: ApiResult<T>;
    try {
      result = await request(api);
    } catch (error) {
      throw this.asGlitchTipError(error, timeoutMs);
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

  /**
   * The typed API, bound to one timeout. A per-call override gets its own
   * instance, so concurrent calls never share a mutable timeout.
   */
  private createApi(timeoutMs: number): GlitchTipApi {
    const api = createClient<paths>({
      baseUrl: this.instance.url,
      fetch: (request) => this.send(request, timeoutMs),
      headers: this.defaultHeaders(),
      redirect: 'manual',
    });
    api.use(pathSegmentGuard(this.instance.url));
    return api;
  }

  private timeoutFor({ timeoutMs }: CallOptions): number {
    if (timeoutMs === undefined) return this.options.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
      // A caller's constant, not agent input: a defect of this server.
      throw new Error(`timeoutMs must be an integer from ${MIN_TIMEOUT_MS} to ${MAX_TIMEOUT_MS}.`);
    }
    return timeoutMs;
  }

  /** The fetch every call uses: timeout per attempt, retries for safe methods. */
  private async send(request: Request, timeoutMs: number): Promise<Response> {
    const retryable = RETRYABLE_METHODS.has(request.method);
    for (let attempt = 0; ; attempt++) {
      const canRetry = retryable && attempt < MAX_RETRIES;
      let response: Response;
      try {
        // A retried request has no body (GET/HEAD), so the clone is safe to repeat.
        response = await this.fetchImpl(
          new Request(request, { signal: AbortSignal.timeout(timeoutMs) }),
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

  private asGlitchTipError(error: unknown, timeoutMs: number): GlitchTipError {
    if (error instanceof GlitchTipError) return this.redacted(error);
    if (isTimeout(error)) return timeoutError(timeoutMs);
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

function buildRawRequest(
  url: URL,
  method: string,
  defaults: Record<string, string>,
  options: RawRequestOptions,
): Request {
  let headers: Headers;
  try {
    headers = new Headers({ ...defaults, ...options.headers });
  } catch {
    throw refusedRequestError('A header name or value is not valid.');
  }
  return new Request(url, {
    method,
    headers,
    body: rawBody(options.body, headers),
    redirect: 'manual',
  });
}

/** A raw call's body: passed through when fetch can send it, JSON otherwise. */
function rawBody(body: unknown, headers: Headers): RequestInit['body'] {
  if (body === undefined) return undefined;
  if (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return body as RequestInit['body'];
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  try {
    return JSON.stringify(body);
  } catch {
    throw refusedRequestError('The body cannot be sent as JSON.');
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
