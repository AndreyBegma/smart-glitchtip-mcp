import type { Middleware } from 'openapi-fetch';
import { type Operation, refusedRequestError } from './glitchtip.errors';

// Checks the client runs on a request before it is sent. Each refusal is an
// `invalid` GlitchTipError that names the rule, never the offending value.

/**
 * Defence in depth for typed calls: a path parameter must stay one segment.
 * openapi-fetch percent-encodes `/`, `\` and `%`, but URL parsing still
 * collapses a value of `.` or `..` — `/organizations/../` would then reach a
 * different route. Comparing the built pathname's segment count with the
 * schema path template's catches every such collapse before sending.
 */
export function pathSegmentGuard(instanceUrl: string): Middleware {
  const prefix = pathPrefix(instanceUrl);
  return {
    onRequest: ({ request, schemaPath }) => {
      const pathname = new URL(request.url).pathname;
      const below = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
      if (segmentCount(below) !== segmentCount(schemaPath)) {
        throw refusedRequestError('A path parameter is not a single path segment.');
      }
    },
  };
}

export type RawQuery = Readonly<Record<string, string | number | boolean | undefined>>;

/**
 * The URL of a raw call: `path` below the instance URL, which must stay on
 * the instance's origin and under its `/api/` after normalisation — the raw
 * call is an escape hatch into the API, never a proxy (AGENTS.md rule 9).
 */
export function rawRequestUrl(
  instanceUrl: string,
  operation: Operation,
  path: string,
  query: RawQuery = {},
): URL {
  const base = new URL(instanceUrl);
  const prefix = pathPrefix(instanceUrl);
  const relative = path.startsWith('/') ? path : `/${path}`;
  const url = URL.canParse(`${base.origin}${prefix}${relative}`)
    ? new URL(`${base.origin}${prefix}${relative}`)
    : undefined;
  if (!url || url.origin !== base.origin || !url.pathname.startsWith(`${prefix}/api/`)) {
    throw refusedRequestError(
      `Refused ${operation.name}: the path must stay under the instance's /api/ (for example /api/0/organizations/).`,
    );
  }
  url.hash = '';
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.append(key, String(value));
  }
  return url;
}

const RESERVED_HEADERS = new Set(['authorization', 'host', 'cookie']);

/** Refuses caller headers that would override the credential or the target. */
export function assertCallerHeaders(headers: Readonly<Record<string, string>>): void {
  for (const name of Object.keys(headers)) {
    if (RESERVED_HEADERS.has(name.toLowerCase())) {
      throw refusedRequestError(
        'Headers may not set Authorization, Host or Cookie; the server sets them.',
      );
    }
  }
}

function pathPrefix(instanceUrl: string): string {
  return new URL(instanceUrl).pathname.replace(/\/+$/, '');
}

function segmentCount(pathname: string): number {
  return pathname.split('/').length;
}
