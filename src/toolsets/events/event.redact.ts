import { asArray, asRecord } from './event.guards';

// D-20: the raw payload and the rendered Request section drop the same
// things before anything else touches them — user IP/geo, request cookies,
// secret-named headers/body fields/query parameters, headers/env/tag fields
// that reveal the caller's IP through a proxy, whatever shape they're stored
// in (current `user`/`request`, the legacy `sentry.interfaces.*` keys, or an
// `entries[]` request entry) and whether headers/query are pairs or an
// object.

const REDACTED = '[redacted]';

/** Cookie, Set-Cookie, Authorization, Proxy-Authorization, X-Api-Key, X-Auth-Token, password, … */
const SECRET_NAME_PATTERN = /cookie|authorization|token|api[-_]?key|secret|password/i;
/** Headers a reverse proxy sets that carry the caller's real IP. */
const IP_HEADER_PATTERN =
  /^(x-forwarded-for|x-real-ip|forwarded|cf-connecting-ip|true-client-ip)$/i;
/** Tag keys GlitchTip or an SDK might use to carry the reporter's IP. */
const IP_TAG_PATTERN = /^(user\.ip|ip|client_ip)$/i;

/** Header, query-parameter, tag key or body-field name: secret by name, or a proxy IP header. */
function isSensitiveName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name) || IP_HEADER_PATTERN.test(name);
}

/** For the rendered Request section (`include_request_headers: true`). */
export function redactHeaderPairs(
  headers: ReadonlyArray<readonly [string, string]>,
): ReadonlyArray<readonly [string, string]> {
  return headers.map(([name, value]) => [name, isSensitiveName(name) ? REDACTED : value] as const);
}

/** For the rendered Request section: `key=value&key2=value2`, secret-named values redacted. */
export function redactQueryString(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = decodeSafely(pair.slice(0, eq));
      return isSensitiveName(key) ? `${pair.slice(0, eq)}=${REDACTED}` : pair;
    })
    .join('&');
}

/** For the rendered Request section: a full or relative URL, its query parameters redacted the same way. */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  const rest = url.slice(queryStart + 1);
  const fragmentStart = rest.indexOf('#');
  const search = fragmentStart === -1 ? rest : rest.slice(0, fragmentStart);
  const fragment = fragmentStart === -1 ? '' : rest.slice(fragmentStart);
  return `${url.slice(0, queryStart)}?${redactQueryString(search)}${fragment}`;
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
  if ('tags' in record) record.tags = redactTags(record.tags);
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
  if (typeof record.url === 'string') record.url = redactUrl(record.url);
  if ('query' in record) record.query = redactQueryField(record.query);
  if ('data' in record) record.data = redactRequestData(record.data);
}

function redactHeadersField(record: Record<string, unknown>): void {
  const { headers } = record;
  if (Array.isArray(headers)) {
    record.headers = headers.map(redactPair);
    return;
  }
  const asObject = asRecord(headers);
  if (!asObject) return;
  for (const name of Object.keys(asObject)) {
    if (isSensitiveName(name)) asObject[name] = REDACTED;
  }
}

function redactQueryField(query: unknown): unknown {
  if (typeof query === 'string') return redactQueryString(query);
  if (Array.isArray(query)) return query.map(redactPair);
  const record = asRecord(query);
  if (!record) return query;
  for (const key of Object.keys(record)) {
    if (isSensitiveName(key)) record[key] = REDACTED;
  }
  return record;
}

/** The request body (`Request.data`): a record's secret-named fields, or a form-encoded string. */
function redactRequestData(data: unknown): unknown {
  if (typeof data === 'string') return redactQueryString(data);
  const record = asRecord(data);
  if (!record) return data;
  for (const key of Object.keys(record)) {
    if (isSensitiveName(key)) record[key] = REDACTED;
  }
  return record;
}

function redactPair(pair: unknown): unknown {
  if (!Array.isArray(pair) || pair.length < 2 || typeof pair[0] !== 'string') return pair;
  return isSensitiveName(pair[0]) ? [pair[0], REDACTED, ...pair.slice(2)] : pair;
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

/** Drops a tag (any shape) whose key names the reporter's IP, instead of merely redacting its value. */
function redactTags(tags: unknown): unknown {
  if (Array.isArray(tags)) {
    return tags.filter((entry) => !isIpTagEntry(entry));
  }
  const record = asRecord(tags);
  if (!record) return tags;
  for (const key of Object.keys(record)) {
    if (isIpTagKey(key)) delete record[key];
  }
  return record;
}

function isIpTagEntry(entry: unknown): boolean {
  const record = asRecord(entry);
  if (!record) return false;
  const key = typeof record.key === 'string' ? record.key : Object.keys(record)[0];
  return key !== undefined && isIpTagKey(key);
}

/** Exported for `event.parser.ts`'s tag parsing — the same drop applies to rendered text/json. */
export function isIpTagKey(key: string): boolean {
  return IP_TAG_PATTERN.test(key);
}
