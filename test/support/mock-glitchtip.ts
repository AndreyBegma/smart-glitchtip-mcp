import type { FetchLike } from '../../src/glitchtip/glitchtip.client';

export interface RecordedRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  /** The body decoded as UTF-8 ('' when there is none). */
  readonly body: string;
  /** The body as sent, for gzip chunks and multipart parts. */
  readonly bodyBytes: Uint8Array;
  readonly redirect: Request['redirect'];
}

type Responder = (request: RecordedRequest) => Response | Promise<Response>;

/**
 * An HTTP-level stand-in for one or more GlitchTip instances, injected as the
 * client's `fetch`. Routes match on method + full URL without the query
 * string; each route answers from a queue (the last answer repeats).
 * An unrouted request fails like a network error and is recorded.
 *
 * Every request must use `redirect: 'manual'`: a client that would follow a
 * redirect could carry the bearer to another host, so the mock refuses it
 * outright and the test fails loudly.
 */
export class MockGlitchTip {
  readonly requests: RecordedRequest[] = [];
  readonly unrouted: RecordedRequest[] = [];
  private readonly routes = new Map<string, Responder[]>();

  on(method: string, url: string, ...responders: (Responder | Response)[]): this {
    this.routes.set(
      routeKey(method, new URL(url)),
      responders.map((r) => (typeof r === 'function' ? r : () => r.clone())),
    );
    return this;
  }

  /** Shorthand: answer with JSON, optionally with headers and a status. */
  json(
    method: string,
    url: string,
    body: unknown,
    init: { status?: number; headers?: Record<string, string> } = {},
  ): this {
    return this.on(method, url, jsonResponse(body, init.status ?? 200, init.headers));
  }

  /** Requests that asked fetch to follow redirects; must stay empty. */
  readonly followingRedirects: RecordedRequest[] = [];

  readonly fetch: FetchLike = async (request) => {
    const bodyBytes = request.body ? new Uint8Array(await request.arrayBuffer()) : new Uint8Array();
    const recorded: RecordedRequest = {
      method: request.method,
      url: new URL(request.url),
      headers: new Headers(request.headers),
      body: new TextDecoder().decode(bodyBytes),
      bodyBytes,
      redirect: request.redirect,
    };
    this.requests.push(recorded);
    if (recorded.redirect !== 'manual') {
      this.followingRedirects.push(recorded);
      throw new Error(`mock GlitchTip: request uses redirect "${recorded.redirect}", not "manual"`);
    }
    const queue = this.routes.get(routeKey(recorded.method, recorded.url));
    if (!queue || queue.length === 0) {
      this.unrouted.push(recorded);
      throw new TypeError('fetch failed');
    }
    const responder = queue.length > 1 ? (queue.shift() as Responder) : queue[0];
    return responder(recorded);
  };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  if (status === 204) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function routeKey(method: string, url: URL): string {
  return `${method.toUpperCase()} ${url.origin}${url.pathname}`;
}
