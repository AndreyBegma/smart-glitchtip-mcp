import type { FetchLike } from '../../src/glitchtip/glitchtip.client';

export interface RecordedRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: string;
}

type Responder = (request: RecordedRequest) => Response | Promise<Response>;

/**
 * An HTTP-level stand-in for one or more GlitchTip instances, injected as the
 * client's `fetch`. Routes match on method + full URL without the query
 * string; each route answers from a queue (the last answer repeats).
 * An unrouted request fails like a network error and is recorded.
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

  readonly fetch: FetchLike = async (request) => {
    const recorded: RecordedRequest = {
      method: request.method,
      url: new URL(request.url),
      headers: new Headers(request.headers),
      body: request.body ? await request.text() : '',
    };
    this.requests.push(recorded);
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
