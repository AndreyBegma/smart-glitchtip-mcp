import type { RawResponse } from '../../glitchtip/glitchtip.client';
import { retryAfterSeconds } from '../../glitchtip/glitchtip.client';
import { errorFromResponse, type Operation } from '../../glitchtip/glitchtip.errors';
import type { Redactor } from '../../glitchtip/redactor';

export interface Outcome {
  readonly isError: boolean;
  readonly message: string;
}

const REJECTION_WAIT_S = 30;
const OPERATION: Operation = { name: 'send test event to the ingest endpoint', scopes: [] };

function parsedBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text === '' ? undefined : text;
  }
}

/**
 * Every status the ingest endpoints can answer with, except the success one
 * (200 for the store route, 201 for security): the foundation's generic
 * messages would be misleading here — a 401 here means the DSN key, not the
 * API token (spec "Outcome mapping") — so they are replaced for this call.
 */
export function ingestFailureOutcome(
  response: RawResponse,
  projectID: number,
): Outcome | undefined {
  const { status } = response;
  if (status === 401) {
    return {
      isError: true,
      message:
        'The DSN key was rejected: it is unknown or inactive for project ' +
        `${projectID}. GlitchTip remembers a rejected key for ${REJECTION_WAIT_S} s.`,
    };
  }
  if (status === 422) {
    return {
      isError: true,
      message: `GlitchTip refused the event as malformed: ${detailOf(response)}.`,
    };
  }
  if (status === 429) {
    const after = retryAfterSeconds(response.headers.get('retry-after'));
    const when = after === undefined ? 'shortly' : `after ${after} s`;
    return {
      isError: true,
      message:
        'The key is valid, but the organization or project is throttled or not accepting ' +
        `events (retry ${when}).`,
    };
  }
  if (status === 503) {
    return { isError: true, message: 'Ingest is paused on this instance (maintenance).' };
  }
  if (status === 403) {
    return {
      isError: true,
      message: `The DSN key does not have permission to send to project ${projectID} (403).`,
    };
  }
  return undefined;
}

/** Every status the two success statuses (200, 201) and the four above don't cover. */
export function ingestFallbackOutcome(response: RawResponse, redactor: Redactor): Outcome {
  const mapped = errorFromResponse(
    response.status,
    parsedBody(response.text),
    OPERATION,
    redactor,
    retryAfterSeconds(response.headers.get('retry-after')),
  );
  return { isError: true, message: mapped.message };
}

function detailOf(response: RawResponse): string {
  const body = parsedBody(response.text);
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail;
    return typeof detail === 'string' ? detail : JSON.stringify(detail);
  }
  return typeof body === 'string' && body !== '' ? body : 'status 422';
}

const EVENT_ID_HEX_32 = /^[0-9a-f]{32}$/i;

/**
 * The store route's 200 body: `{event_id}` is all this server reads (D-12).
 * Accepted only when it is the 32-hex-character form this server sends, or
 * literally the id sent (a GlitchTip that echoes it back in another
 * notation) — anything else is not read as "the" event id, so an agent is
 * never handed text GlitchTip did not actually generate for this event.
 */
export function parseEventId(text: string, sentEventId?: string): string | undefined {
  const body = parsedBody(text);
  if (!body || typeof body !== 'object') return undefined;
  const eventId = (body as { event_id?: unknown }).event_id;
  if (typeof eventId !== 'string') return undefined;
  if (EVENT_ID_HEX_32.test(eventId) || eventId === sentEventId) return eventId;
  return undefined;
}
