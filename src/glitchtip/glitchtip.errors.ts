import { AgentFacingError } from '../agent-facing.error';
import type { Redactor } from './redactor';

export type GlitchTipErrorKind =
  | 'invalid'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'upstream'
  | 'malformed'
  | 'timeout'
  | 'unreachable';

/**
 * What a tool is doing when it calls GlitchTip. It turns a bare status code
 * into a message an agent can act on ("…needs one of: org:admin").
 */
export interface Operation {
  /** Human phrase, e.g. "delete organization". */
  readonly name: string;
  /** Token scopes any one of which GlitchTip accepts for this route. */
  readonly scopes: readonly string[];
  /**
   * For routes GlitchTip does not gate by scope: what it does need, in words
   * (e.g. "superuser rights"). Replaces the scope list in a 403 message.
   */
  readonly requirement?: string;
  /** For 404s: what was looked up, e.g. "Organization". */
  readonly resource?: string;
  readonly id?: string | number;
  readonly org?: string;
}

const DETAIL_LIMIT = 500;

/**
 * A failed GlitchTip call. `message` is written for the agent and is what the
 * tool result shows; it never contains the token or the Authorization header.
 */
export class GlitchTipError extends AgentFacingError {
  constructor(
    readonly kind: GlitchTipErrorKind,
    message: string,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
  }
}

/**
 * Maps a non-2xx response that retries did not fix. `redactor` is applied to
 * GlitchTip's detail before it is cut to size, so no secret is left half-cut.
 */
export function errorFromResponse(
  status: number,
  body: unknown,
  operation: Operation,
  redactor: Redactor,
  retryAfterSeconds?: number,
): GlitchTipError {
  const detail = detailOf(body, redactor);
  if (status === 400 || status === 422) {
    return new GlitchTipError(
      'invalid',
      `GlitchTip rejected the request: ${detail ?? `status ${status}`}`,
      status,
      detail,
    );
  }
  if (status === 401) {
    return new GlitchTipError(
      'unauthenticated',
      'The GlitchTip token was rejected (401). Check the token.',
      status,
      detail,
    );
  }
  if (status === 403) {
    return new GlitchTipError('forbidden', forbiddenMessage(operation), status, detail);
  }
  if (status === 404) {
    return new GlitchTipError('not_found', notFoundMessage(operation), status, detail);
  }
  if (status === 429) {
    const after = retryAfterSeconds === undefined ? 'shortly' : `after ${retryAfterSeconds}s`;
    return new GlitchTipError(
      'rate_limited',
      `GlitchTip is rate-limiting; retry ${after}.`,
      status,
      detail,
    );
  }
  if (status >= 300 && status < 400) {
    return new GlitchTipError(
      'upstream',
      `GlitchTip answered with a redirect (${status}); set the instance URL to the address it redirects to.`,
      status,
    );
  }
  return new GlitchTipError('upstream', `GlitchTip returned ${status}.`, status, detail);
}

export function timeoutError(timeoutMs: number): GlitchTipError {
  return new GlitchTipError('timeout', `GlitchTip did not answer within ${timeoutMs} ms.`);
}

export function unreachableError(origin: string): GlitchTipError {
  return new GlitchTipError('unreachable', `Could not reach ${origin}.`);
}

export function malformedResponseError(): GlitchTipError {
  return new GlitchTipError(
    'malformed',
    'GlitchTip answered with a body that is not valid JSON; is the instance URL pointing at GlitchTip?',
  );
}

/** A list endpoint answered 2xx with something other than an array. */
export function malformedListError({ name }: Operation): GlitchTipError {
  return new GlitchTipError(
    'malformed',
    `GlitchTip answered ${name} with something other than a list. The request itself succeeded; the instance may run a GlitchTip version this server does not know.`,
  );
}

/**
 * A request the client refused to send: a path parameter that is not one
 * segment, or a raw path outside the instance's API. Names the rule, never
 * the value.
 */
export function refusedRequestError(reason: string): GlitchTipError {
  return new GlitchTipError('invalid', reason);
}

function forbiddenMessage({ name, scopes, requirement }: Operation): string {
  const refused = `The token lacks permission for ${name}.`;
  if (requirement) return `${refused} It needs ${requirement}.`;
  if (scopes.length === 0) return `${refused} GlitchTip names no scope for it.`;
  return `${refused} It needs one of: ${scopes.join(', ')}.`;
}

function notFoundMessage({ name, resource, id, org }: Operation): string {
  if (!resource) return `Nothing was found for ${name}.`;
  const what = id === undefined ? resource : `${resource} ${id}`;
  return org ? `${what} was not found in ${org}.` : `${what} was not found.`;
}

/**
 * GlitchTip's `detail` (a string, or django-ninja's list of validation
 * errors), redacted and bounded. Secrets go first, whole; the cut comes after;
 * then a secret's start left at the end is removed — whether this cut left it
 * or GlitchTip cut its own message there (BUG-20260925-017).
 */
function detailOf(body: unknown, redactor: Redactor): string | undefined {
  if (body === undefined || body === null || body === '') return undefined;
  const raw =
    typeof body === 'object' && 'detail' in body ? (body as { detail: unknown }).detail : body;
  const text = redactor.redact(typeof raw === 'string' ? raw : JSON.stringify(raw));
  if (text.length <= DETAIL_LIMIT) return redactor.redactCutEnd(text);
  return `${redactor.redactCutEnd(text.slice(0, DETAIL_LIMIT))}…`;
}
