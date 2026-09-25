import { asArray, asRecord } from './event.guards';

// D-20: the raw payload and the request section of every rendering drop the
// same things before anything else touches them — user IP/geo, request
// cookies, secret headers, and headers/context fields that reveal the
// caller's IP through a proxy, whatever shape they're stored in (current
// `user`/`request`, the legacy `sentry.interfaces.*` keys, or an `entries[]`
// request entry) and whether headers are pairs or an object.

const REDACTED = '[redacted]';

/** Cookie, Set-Cookie, Authorization, Proxy-Authorization, X-Api-Key, X-Auth-Token, … */
const SECRET_HEADER_PATTERN = /cookie|authorization|token|api-?key|secret/i;
/** Headers a reverse proxy sets that carry the caller's real IP. */
const IP_HEADER_PATTERN =
  /^(x-forwarded-for|x-real-ip|forwarded|cf-connecting-ip|true-client-ip)$/i;

function isSensitiveHeader(name: string): boolean {
  return SECRET_HEADER_PATTERN.test(name) || IP_HEADER_PATTERN.test(name);
}

/** For the rendered Request section (`include_request_headers: true`). */
export function redactHeaderPairs(
  headers: ReadonlyArray<readonly [string, string]>,
): ReadonlyArray<readonly [string, string]> {
  return headers.map(
    ([name, value]) => [name, isSensitiveHeader(name) ? REDACTED : value] as const,
  );
}

/**
 * `get_event_json` and the `json` format: a deep-cloned copy of the raw
 * payload with every PII/secret field above removed or redacted, whatever
 * shape it's stored in.
 */
export function redactEventPayload(raw: unknown): unknown {
  const clone = structuredClone(raw);
  const record = asRecord(clone);
  if (!record) return clone;
  redactUser(record.user);
  redactUser(record['sentry.interfaces.User']);
  redactRequest(record.request);
  redactRequest(record['sentry.interfaces.Http']);
  redactRequestEntries(record.entries);
  redactContexts(record.contexts);
  return record;
}

function redactUser(user: unknown): void {
  const record = asRecord(user);
  if (!record) return;
  delete record.ip_address;
  delete record.geo;
  delete record.client_ip;
}

function redactRequest(request: unknown): void {
  const record = asRecord(request);
  if (!record) return;
  if ('cookies' in record) record.cookies = REDACTED;
  redactHeadersField(record);
  const env = asRecord(record.env);
  if (env) delete env.REMOTE_ADDR;
}

function redactHeadersField(record: Record<string, unknown>): void {
  const { headers } = record;
  if (Array.isArray(headers)) {
    record.headers = headers.map(redactHeaderPair);
    return;
  }
  const asObject = asRecord(headers);
  if (!asObject) return;
  for (const name of Object.keys(asObject)) {
    if (isSensitiveHeader(name)) asObject[name] = REDACTED;
  }
}

function redactHeaderPair(pair: unknown): unknown {
  if (!Array.isArray(pair) || pair.length < 2 || typeof pair[0] !== 'string') return pair;
  return isSensitiveHeader(pair[0]) ? [pair[0], REDACTED, ...pair.slice(2)] : pair;
}

/** The `entries[type="request"].data` shape (D-18/D-20 apply here too). */
function redactRequestEntries(entries: unknown): void {
  const array = asArray(entries);
  if (!array) return;
  for (const entry of array) {
    const record = asRecord(entry);
    if (record?.type !== 'request') continue;
    redactRequest(record.data);
  }
}

function redactContexts(contexts: unknown): void {
  const record = asRecord(contexts);
  if (!record) return;
  for (const value of Object.values(record)) {
    const context = asRecord(value);
    if (context) delete context.client_ip;
  }
}
