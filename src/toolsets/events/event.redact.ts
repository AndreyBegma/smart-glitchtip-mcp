import { asRecord } from './event.guards';

// D-20: the raw payload and the request section of every rendering drop the
// same three things before anything else touches them — user IP/geo, request
// cookies, and the Cookie/Authorization headers (array-of-pairs or object,
// header names compared case-insensitively).

const SECRET_HEADERS = new Set(['cookie', 'authorization']);
const REDACTED = '[redacted]';

function isSecretHeader(name: string): boolean {
  return SECRET_HEADERS.has(name.toLowerCase());
}

/** For the rendered Request section (`include_request_headers: true`). */
export function redactHeaderPairs(
  headers: ReadonlyArray<readonly [string, string]>,
): ReadonlyArray<readonly [string, string]> {
  return headers.map(([name, value]) => [name, isSecretHeader(name) ? REDACTED : value] as const);
}

/**
 * `get_event_json` and the `json` format: a deep-cloned copy of the raw
 * payload with `user.ip_address`, `user.geo` removed and request cookies /
 * secret headers redacted, whatever shape `request.headers` takes.
 */
export function redactEventPayload(raw: unknown): unknown {
  const clone = structuredClone(raw);
  const record = asRecord(clone);
  if (!record) return clone;
  redactUser(record.user);
  redactRequest(record.request);
  return record;
}

function redactUser(user: unknown): void {
  const record = asRecord(user);
  if (!record) return;
  delete record.ip_address;
  delete record.geo;
}

function redactRequest(request: unknown): void {
  const record = asRecord(request);
  if (!record) return;
  if ('cookies' in record) record.cookies = REDACTED;
  if (Array.isArray(record.headers)) {
    record.headers = record.headers.map(redactHeaderPair);
    return;
  }
  const headers = asRecord(record.headers);
  if (!headers) return;
  for (const name of Object.keys(headers)) {
    if (isSecretHeader(name)) headers[name] = REDACTED;
  }
}

function redactHeaderPair(pair: unknown): unknown {
  if (!Array.isArray(pair) || pair.length < 2 || typeof pair[0] !== 'string') return pair;
  return isSecretHeader(pair[0]) ? [pair[0], REDACTED, ...pair.slice(2)] : pair;
}
