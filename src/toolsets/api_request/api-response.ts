import { flatten } from '../../format/sanitize';
import { untrusted } from '../../format/untrusted';
import { type RawResponse, retryAfterSeconds } from '../../glitchtip/glitchtip.client';
import { errorFromResponse, GlitchTipError } from '../../glitchtip/glitchtip.errors';
import { parseNextCursor } from '../../glitchtip/pagination';
import { type RedactorFor, redactJson, redactText } from './redact-body';

// Turns a raw escape-hatch response into a result or a tool error. Every body
// is redacted here, before anything else reads it (FEAT-20260925-015).

/** The response body, redacted, as far as its content type lets it be shown. */
export type ApiBody =
  | { readonly kind: 'none' }
  | { readonly kind: 'json'; readonly value: unknown }
  | { readonly kind: 'unparsed-json'; readonly text: string }
  | { readonly kind: 'text'; readonly contentType: string; readonly text: string }
  | { readonly kind: 'binary'; readonly contentType: string; readonly bytes: number };

export interface ApiResult {
  /** `<METHOD> /api/0/<path>/` — built by this server, never from the response. */
  readonly request: string;
  readonly status: number;
  readonly nextCursor?: string;
  readonly body: ApiBody;
}

/** What was requested: the method and the normalised `/api/0/…/` target. */
export interface ApiTarget {
  readonly method: string;
  readonly target: string;
}

/** A 2xx becomes a result; anything else a `GlitchTipError` whose detail is redacted. */
export function readApiResponse(
  response: RawResponse,
  call: ApiTarget,
  redactorFor: RedactorFor,
): ApiResult {
  const body = redactedBody(response, redactorFor);
  if (response.status < 200 || response.status >= 300) {
    throw apiError(response, body, call, redactorFor);
  }
  return {
    request: `${call.method} ${call.target}`,
    status: response.status,
    nextCursor: parseNextCursor(response.headers.get('link')),
    body,
  };
}

function redactedBody(response: RawResponse, redactorFor: RedactorFor): ApiBody {
  const { text } = response;
  if (response.status === 204 || text === '') return { kind: 'none' };
  const redactor = redactorFor([]);
  const contentType = contentTypeOf(response.headers);
  if (/^application\/(?:[\w.+-]+\+)?json$/.test(contentType)) {
    const scrubbed = redactor.redact(text);
    try {
      return { kind: 'json', value: redactJson(JSON.parse(scrubbed), redactorFor) };
    } catch {
      return { kind: 'unparsed-json', text: redactText(scrubbed, redactor) };
    }
  }
  if (contentType.startsWith('text/')) {
    return { kind: 'text', contentType, text: redactText(text, redactor) };
  }
  return { kind: 'binary', contentType: contentType || 'unknown', bytes: byteLength(response) };
}

/** The media type, lower case and without parameters; `unrecognised` when it is not one. */
function contentTypeOf(headers: Headers): string {
  const raw = headers.get('content-type');
  if (raw === null) return '';
  const type = raw.split(';')[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) ? type : 'unrecognised';
}

function byteLength({ headers, text }: RawResponse): number {
  const declared = headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared.trim())) return Number(declared.trim());
  return new TextEncoder().encode(text).length;
}

function apiError(
  response: RawResponse,
  body: ApiBody,
  call: ApiTarget,
  redactorFor: RedactorFor,
): GlitchTipError {
  const request = `${call.method} ${call.target}`;
  const mapped = errorFromResponse(
    response.status,
    detailSource(body),
    { name: request, scopes: [] },
    redactorFor([]),
    retryAfterSeconds(response.headers.get('retry-after')),
  );
  const message = `${messageFor(mapped, call, request)}${detailLine(mapped.detail)}`;
  return new GlitchTipError(mapped.kind, message, response.status, mapped.detail);
}

function detailSource(body: ApiBody): unknown {
  if (body.kind === 'json') return body.value;
  if (body.kind === 'text' || body.kind === 'unparsed-json') return body.text;
  return undefined;
}

function messageFor(mapped: GlitchTipError, call: ApiTarget, request: string): string {
  switch (mapped.kind) {
    case 'forbidden':
      return `The token lacks permission for ${request}. Call \`whoami\` to see the token's scopes.`;
    case 'not_found':
      return `No GlitchTip route or object at ${call.target}.`;
    case 'invalid':
      return `GlitchTip rejected ${request} (${mapped.status}).`;
    default:
      return `${request}: ${mapped.message}`;
  }
}

/** GlitchTip's own words, redacted and bounded by `errorFromResponse`, and fenced (D-18). */
function detailLine(detail: string | undefined): string {
  if (detail === undefined || detail === '') return '';
  return `\nGlitchTip said: ${untrusted('api.detail', flatten(detail), 'glitchtip-event')}`;
}
