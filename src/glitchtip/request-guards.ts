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
  // An encoded slash, backslash or dot is either collapsed by URL parsing
  // (`%2e%2e`) or decoded by a proxy or the server into a different route.
  if (ENCODED_SEPARATOR.test(path)) {
    throw refusedRequestError(
      `Refused ${operation.name}: the path may not contain an encoded /, \\ or . (%2F, %5C, %2E).`,
    );
  }
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

const ENCODED_SEPARATOR = /%(2f|5c|2e)/i;

const RESERVED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'host',
  'cookie',
  'forwarded',
  'x-real-ip',
]);

/**
 * Refuses caller headers that would override the credential or the target,
 * or speak for the client's address to a proxy in front of GlitchTip.
 */
export function assertCallerHeaders(headers: Readonly<Record<string, string>>): void {
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (RESERVED_HEADERS.has(lower) || lower.startsWith('x-forwarded-')) {
      throw refusedRequestError(
        'Headers may not set Authorization, Proxy-Authorization, Host, Cookie, Forwarded, X-Forwarded-* or X-Real-IP.',
      );
    }
  }
}

const RAW_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** The upper-cased method of a raw call; refuses any other verb and a body on GET/HEAD. */
export function rawMethod(method: string, hasBody: boolean): string {
  const verb = method.toUpperCase();
  if (!RAW_METHODS.has(verb)) {
    throw refusedRequestError('The method must be one of GET, HEAD, POST, PUT, PATCH, DELETE.');
  }
  if (hasBody && (verb === 'GET' || verb === 'HEAD')) {
    throw refusedRequestError(`A ${verb} request cannot carry a body.`);
  }
  return verb;
}

function pathPrefix(instanceUrl: string): string {
  return new URL(instanceUrl).pathname.replace(/\/+$/, '');
}

function segmentCount(pathname: string): number {
  return pathname.split('/').length;
}
