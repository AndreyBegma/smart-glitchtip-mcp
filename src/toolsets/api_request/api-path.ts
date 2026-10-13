import { ApiRequestRefusal } from './api-refusal';

// The path rules of the escape hatch (FEAT-20260925-015 "Path rules", AGENTS.md
// rule 9): nothing an agent passes as `path` can name a scheme, a host, a port
// or a route outside the resolved instance's /api/0/.

export const API_ROOT = '/api/0/';
export const MAX_PATH_LENGTH = 2000;

/** A path an agent may call, after every rule has passed. */
export interface ApiPath {
  /** The decoded segments below /api/0/, as GlitchTip routes them. */
  readonly segments: readonly string[];
  /**
   * `/api/0/<segments, each percent-encoded>/`: what is requested, what
   * results are headed with and what `confirm` restates.
   */
  readonly target: string;
}

/** `\p{Cc}`: C0 controls (NUL included), DEL and C1 controls. */
const REFUSED_RAW = /[\\@?#\s\p{Cc}]/u;
/** What a percent-escape may not decode to: no encoded separator, dot, escape or control. */
const REFUSED_ESCAPED = /[/\\.%?#\p{Cc}]/u;
const ALLOWED_DECODED = /^[A-Za-z0-9\-_.~/+:,=]*$/;

/**
 * Checks and normalises a caller's path, relative to /api/0/ (a leading
 * `/api/0/` or `api/0/` is accepted and dropped). The empty path is the API
 * root. Throws `ApiRequestRefusal` naming the broken rule, never the input.
 */
export function normalizeApiPath(input: string): ApiPath {
  if (input.length > MAX_PATH_LENGTH) {
    refuse(`the path must be at most ${MAX_PATH_LENGTH} characters.`);
  }
  refuseRawForms(input);
  const segments = segmentsOf(decodeOnce(withoutApiPrefix(input)));
  const target =
    segments.length === 0 ? API_ROOT : `${API_ROOT}${segments.map(encodeURIComponent).join('/')}/`;
  return { segments, target };
}

/**
 * The second line of defence: the URL built from the instance and `target`
 * must stay on the instance's origin and under its `<prefix>/api/0/`, with
 * nothing collapsed by URL parsing. `client.raw()` repeats the origin check.
 */
export function assertInsideApi(instanceUrl: string, target: string): void {
  const base = new URL(instanceUrl);
  const prefix = base.pathname.replace(/\/+$/, '');
  const expected = `${prefix}${target}`;
  const url = URL.canParse(`${base.origin}${expected}`)
    ? new URL(`${base.origin}${expected}`)
    : undefined;
  if (
    !url ||
    url.origin !== base.origin ||
    !url.pathname.startsWith(`${prefix}${API_ROOT}`) ||
    url.pathname !== expected
  ) {
    refuse("the path does not stay under the instance's /api/0/.");
  }
}

function refuseRawForms(input: string): void {
  if (input.startsWith('//')) refuse('the path may not start with //.');
  if (namesScheme(input)) refuse('the path may not name a scheme (a `:` before the first `/`).');
  if (REFUSED_RAW.test(input)) {
    refuse(
      'the path may not contain \\, @, ?, #, whitespace or control characters; put query parameters in `query`.',
    );
  }
}

function withoutApiPrefix(input: string): string {
  for (const prefix of ['/api/0/', 'api/0/']) {
    if (input.startsWith(prefix)) return input.slice(prefix.length);
  }
  if (input === '/api/0' || input === 'api/0') return '';
  return input.startsWith('/') ? input.slice(1) : input;
}

/** Percent-decodes once; an escape of a separator, dot, `%` or control is refused first. */
function decodeOnce(path: string): string {
  for (const [, hex] of path.matchAll(/%(.{0,2})/gs)) {
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) refuse('a `%` in the path must start an escape (%XX).');
    const byte = Number.parseInt(hex, 16);
    // A byte of 0x80 or more is part of a UTF-8 character, not a control:
    // the allowed-characters rule judges it once decoded.
    if (byte < 0x80 && REFUSED_ESCAPED.test(String.fromCharCode(byte))) {
      refuse(
        'the path may not contain an encoded /, \\, ., %, ?, # or control character (no encoded traversal or double encoding).',
      );
    }
  }
  try {
    return decodeURIComponent(path);
  } catch {
    return refuse('the path is not valid percent-encoded UTF-8.');
  }
}

function segmentsOf(decoded: string): string[] {
  if (decoded === '') return [];
  if (namesScheme(decoded)) refuse('the path may not name a scheme (a `:` before the first `/`).');
  if (!ALLOWED_DECODED.test(decoded)) {
    refuse('the path may contain only A–Z a–z 0–9 - _ . ~ / + : , = (after percent-decoding).');
  }
  const segments = (decoded.endsWith('/') ? decoded.slice(0, -1) : decoded).split('/');
  if (segments.some((segment) => segment === '')) {
    refuse('the path may not contain empty segments (//).');
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    refuse('the path may not contain . or .. segments.');
  }
  return segments;
}

function namesScheme(path: string): boolean {
  const slash = path.indexOf('/');
  return (slash === -1 ? path : path.slice(0, slash)).includes(':');
}

function refuse(rule: string): never {
  throw new ApiRequestRefusal(`Refused before any request: ${rule}`);
}
