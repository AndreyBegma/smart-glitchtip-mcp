import { flatten } from '../../format/sanitize';
import { keyValues, table, withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';

type LogEvent = components['schemas']['LogEventSchema'];
type LogStats = components['schemas']['LogStatsSchema'];
type LogResource = components['schemas']['LogResourceSchema'];

// Views project GlitchTip's payloads down to the fields an agent uses (D-12). Log body,
// service, environment, host, spanID, resource names, and every attribute key/value in
// `data` are untrusted (D-18, spec §Untrusted text) — every list here fences its whole rows
// section once, not per cell or per row (spec §Untrusted text: "one fence per section, not
// one per cell"), and `get_log`'s attribute block is fenced the same way, once, rather than
// per line — a per-line fence could nest or be forged by a crafted key.
//
// PII in log attributes (spec §PII in logs, D-20's rule applied to logs): a key matches when
// its full dotted/underscored/camelCase path, tokenised, contains a sensitive run of tokens
// contiguously anywhere — including as a trailing suffix, so `http.request.header.
// x-forwarded-for`, `source.client.address` and `clientIP` all match, not only an exact bare
// segment. The value is replaced everywhere: text and json alike, recursing through objects
// *and* arrays at any depth. The body is never redacted — free text can't be.

const BODY_LIST_LIMIT = 300;
const BODY_DETAIL_LIMIT = 4000;
/** Caps a single untrusted field so a shared response-budget cut can't land mid-fence. */
const FIELD_CAP = 2000;
const RESOURCE_LIMIT = 100;

const REDACTED = '[redacted]';

/**
 * Sensitive token runs: a key matches when its tokenised path contains one of these,
 * contiguously, anywhere. A bare single-token name (`ip`, `geo`, …) catches most of D-20's
 * list on its own; the multi-token runs exist for the compound names a single-token check
 * would miss (`client.address`, `remote_addr`), and the OTel `*.address` / `*.peer.address`
 * family the review asked to add explicitly, on top of the single `address` token, which
 * already covers them.
 */
const SENSITIVE_RUNS: readonly (readonly string[])[] = [
  ['ip'],
  ['cookie'],
  ['cookies'],
  ['authorization'],
  ['geo'],
  ['address'],
  ['ip', 'address'],
  ['client', 'address'],
  ['remote', 'addr'],
  ['x', 'forwarded', 'for'],
  ['x', 'real', 'ip'],
  ['set', 'cookie'],
  ['proxy', 'authorization'],
  ['user', 'geo'],
  ['peer', 'address'],
];

/** A whole token that names an IP address by itself, digits and all: ip, ip4, ip6, ipv4, ipv6. */
const IP_TOKEN = /^ipv?\d*$/;

/**
 * Splits a dotted/underscored/dashed/camelCase key path into lowercase tokens. Two boundary
 * passes: `lowerUpper` splits an ordinary camelCase transition (`clientIp` → `client`/`Ip`);
 * `acronymWord` then splits an acronym run from the capitalised word after it
 * (`userIPAddress` → `user`/`IP`/`Address`, not one `ipaddress` blob) — without it, only the
 * first letter of a run like `IPAddress` would ever separate from what follows.
 */
function tokenize(key: string): string[] {
  const lowerUpper = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  const acronymWord = lowerUpper.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');
  return acronymWord
    .toLowerCase()
    .split(/[._-]+/)
    .filter(Boolean);
}

/** `key` is the full path from the attribute root (e.g. "user.geo.city", "clientIP", "ipv4"). Exported for its own unit tests. */
export function isSensitiveAttributeKey(key: string): boolean {
  const tokens = tokenize(key);
  return (
    tokens.some((token) => IP_TOKEN.test(token)) ||
    SENSITIVE_RUNS.some((run) => containsRun(tokens, run))
  );
}

function containsRun(tokens: readonly string[], run: readonly string[]): boolean {
  if (run.length > tokens.length) return false;
  for (let start = 0; start <= tokens.length - run.length; start++) {
    if (run.every((token, i) => tokens[start + i] === token)) return true;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `format: "json"`, and the base every text rendering builds from: a deep clone of `data`
 * with every sensitive leaf value replaced, recursing through objects *and* arrays at any
 * depth. A leaf is judged on its own full path, never a collapsed ancestor — `user.geo.city`
 * and `user.geo` are each checked independently. Exported for its own unit tests.
 */
export function redactAttributesForJson(data: unknown): unknown {
  const result = redactValue(data, '');
  return result === undefined ? null : result;
}

function redactValue(value: unknown, path: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item, i) => {
      if (isHeaderPair(item)) return redactHeaderPair(item);
      return redactValue(item, path ? `${path}.${i}` : String(i));
    });
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = redactValue(v, path ? `${path}.${key}` : key);
    }
    return out;
  }
  return isSensitiveAttributeKey(path) ? REDACTED : value;
}

/**
 * A `[name, value]` pair (a header represented as a 2-element array, the shape
 * `event.redact.ts` also handles for events): the PII is in `name` itself, a data value
 * rather than an object key, so the usual key-path check never sees it. Matched by shape,
 * not by position in a larger structure, so it applies at any depth an array reaches.
 */
function isHeaderPair(item: unknown): item is [string, unknown, ...unknown[]] {
  return (
    Array.isArray(item) &&
    item.length >= 2 &&
    typeof item[0] === 'string' &&
    isSensitiveAttributeKey(item[0])
  );
}

function redactHeaderPair(pair: readonly unknown[]): unknown[] {
  return [pair[0], REDACTED, ...pair.slice(2)];
}

interface FlatAttribute {
  readonly key: string;
  readonly value: string;
}

const MAX_DEPTH = 4;
const MAX_ATTRIBUTES = 50;
const VALUE_CAP = 200;

/**
 * Text rendering (`get_log`): the redacted clone (above) flattened to `key = value` lines,
 * objects and arrays dotted up to MAX_DEPTH, at most MAX_ATTRIBUTES lines. Exported for its
 * own unit tests.
 */
export function flattenAttributes(data: unknown): {
  readonly attributes: readonly FlatAttribute[];
  readonly more: number;
} {
  const all: FlatAttribute[] = [];
  const redacted = redactAttributesForJson(data);
  // Only a genuine attributes container is flattened: `data` missing, null or some other
  // non-object shape renders no attributes at all, not one spurious "(root) = -" line.
  if (isPlainObject(redacted) || Array.isArray(redacted)) flattenValue(redacted, '', 0, all);
  const attributes = all.slice(0, MAX_ATTRIBUTES);
  return { attributes, more: Math.max(0, all.length - attributes.length) };
}

function flattenValue(value: unknown, path: string, depth: number, out: FlatAttribute[]): void {
  if (depth < MAX_DEPTH && Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ key: path || '(root)', value: '[]' });
      return;
    }
    value.forEach((item, i) => {
      flattenValue(item, path ? `${path}.${i}` : String(i), depth + 1, out);
    });
    return;
  }
  if (depth < MAX_DEPTH && isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      out.push({ key: path || '(root)', value: '{}' });
      return;
    }
    for (const [key, v] of entries) {
      flattenValue(v, path ? `${path}.${flatten(key)}` : flatten(key), depth + 1, out);
    }
    return;
  }
  out.push({ key: path || '(root)', value: capText(flatten(displayValue(value)), VALUE_CAP) });
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '?';
  if (typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Small display guards so a malformed field degrades to "?" in text instead of printing
// "undefined"/"NaN" or a raw non-conforming value; `undefined`/`null` pass through so
// keyValues can still drop a field that is legitimately absent, rather than showing "?".

function num(value: unknown): number | '?' | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : '?';
}

const STRICT_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;
function iso(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' && STRICT_ISO.test(value) ? value : '?';
}

const TRACE_ID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
function traceIdText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' && TRACE_ID.test(value) ? value : '?';
}

export function listLogsView(
  page: Page<LogEvent>,
  org: string,
  range: { readonly start: string; readonly end: string },
): View {
  const logs = page.items;
  return {
    untrusted: { field: 'logs', source: 'glitchtip-event' },
    text: () => {
      if (logs.length === 0) {
        return `No logs match in ${org} between ${range.start} and ${range.end}.`;
      }
      const hitLine = hitCountLine(page.headers);
      const fenced = untrusted('logs', rowsBlock(logs), 'glitchtip-event');
      return withCursor(hitLine ? `${hitLine}\n${fenced}` : fenced, page.nextCursor);
    },
    json: () => ({
      logs: logs.map((log) => logProjection(log)),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

function rowsBlock(logs: readonly LogEvent[]): string {
  const body = table(logs, [
    { header: 'timestamp', value: (l) => iso(l.timestamp) },
    { header: 'level', value: (l) => l.level },
    { header: 'service', value: (l) => l.service },
    { header: 'project', value: (l) => l.projectId },
    { header: 'logId', value: (l) => l.id },
  ]);
  const [header, ...lines] = body.split('\n');
  const withBody = lines.map(
    (line, i) => `${line}  ${capText(flatten(logs[i]?.body ?? ''), BODY_LIST_LIMIT)}`,
  );
  return [header, ...withBody].join('\n');
}

function hitCountLine(headers: Headers): string | undefined {
  const raw = headers.get('x-hits');
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  return `≈${raw} matches, counted up to 1000`;
}

export function getLogView(log: LogEvent): View {
  const { attributes, more } = flattenAttributes(log.data);
  const attributeLines = attributes.map((a) => `  ${a.key} = ${a.value}`);
  if (more > 0) attributeLines.push(`  … ${more} more attributes`);
  const attributesBlock =
    attributeLines.length > 0
      ? untrusted('log.attributes', attributeLines.join('\n'), 'glitchtip-event')
      : '(none)';
  return {
    untrusted: { field: 'log', source: 'glitchtip-event' },
    text: () =>
      `${keyValues([
        ['id', log.id],
        ['timestamp', iso(log.timestamp)],
        ['level', log.level],
        ['project', log.projectId],
        ['service', fenced('service', log.service)],
        ['environment', fenced('environment', log.environment)],
        ['host', fenced('host', log.host)],
        ['traceID', traceIdText(log.traceID)],
        ['spanID', fenced('spanID', log.spanID)],
        ['severityNumber', num(log.severityNumber)],
        ['body', untrusted('body', detailBodyText(log.body ?? ''), 'glitchtip-event')],
      ])}\nattributes:\n${attributesBlock}`,
    json: () => ({
      id: log.id,
      timestamp: log.timestamp,
      level: log.level,
      projectId: log.projectId,
      service: log.service,
      environment: log.environment,
      host: log.host,
      traceID: log.traceID ?? null,
      spanID: log.spanID ?? null,
      severityNumber: log.severityNumber ?? null,
      body: log.body,
      data: redactAttributesForJson(log.data),
    }),
  };
}

/**
 * Line/paragraph separators, built from code points rather than typed literally: like
 * `sanitize.ts`'s own character classes, a raw U+2028/U+2029 in source is invisible and
 * fragile through tooling (and a LineTerminator can't appear inside a regex literal at
 * all). Spec §Untrusted text: in `get_log`, a newline — or either of these — becomes ` ⏎ `
 * so structure stays visible instead of being collapsed away.
 */
const LINE_BREAK = new RegExp(
  `\\r\\n|\\r|\\n|${String.fromCharCode(0x2028)}|${String.fromCharCode(0x2029)}`,
  'g',
);

function detailBodyText(body: string): string {
  const marked = body.replace(LINE_BREAK, ' ⏎ ');
  return capText(marked.replace(/[ \t]+/g, ' ').trim(), BODY_DETAIL_LIMIT);
}

export function getLogStatsView(
  stats: LogStats,
  range: { readonly start: string; readonly end: string },
  bucketing: 'hour' | 'day',
  hashBucketNote: {
    readonly service?: readonly string[];
    readonly environment?: readonly string[];
  },
): View {
  const intervals = stats.intervals ?? [];
  const series = stats.series ?? [];
  const length = Math.min(intervals.length, ...series.map((s) => (s.data ?? []).length), Infinity);
  const safeLength = Number.isFinite(length) ? length : intervals.length;
  const mismatched = series.some((s) => (s.data ?? []).length !== intervals.length);
  const note = hashBucketNoteText(hashBucketNote);
  return {
    untrusted: { field: 'log_stats', source: 'glitchtip-event' },
    text: () => {
      if (intervals.length === 0 || series.length === 0) {
        const empty = `No log activity in the requested range (${range.start} to ${range.end}).`;
        return note ? untrusted('log_stats', `${empty}\n${note}`, 'glitchtip-event') : empty;
      }
      const totals = series.map((s) => ({ name: flatten(s.name), ...sum(s.data, safeLength) }));
      const busiest = series.map((s) => ({
        name: flatten(s.name),
        ...busiestBucket(s.data, intervals, safeLength),
      }));
      const lines: string[] = [];
      lines.push(`totals: ${totals.map((t) => `${t.name}=${t.total}`).join(', ')}`);
      lines.push(
        `busiest: ${busiest
          .map((b) => (b.at ? `${b.name} @ ${b.at} (${b.value})` : `${b.name}: -`))
          .join(', ')}`,
      );
      if (note) lines.push(note);
      if (mismatched)
        lines.push('(series and intervals lengths differ; showing the common prefix)');
      if (hasUnavailableValue(series, safeLength)) {
        lines.push(
          'Some values are unavailable (excluded from totals and the busiest bucket) — not the same as a known 0.',
        );
      }
      lines.push(`buckets (${bucketing}):`);
      lines.push(...bucketLines(intervals.slice(0, safeLength), series, safeLength, bucketing));
      return untrusted('log_stats', lines.join('\n'), 'glitchtip-event');
    },
    json: () => ({
      intervals: intervals.slice(0, safeLength),
      series: series.map((s) => ({ name: s.name, data: (s.data ?? []).slice(0, safeLength) })),
    }),
  };
}

function hashBucketNoteText(filter: {
  readonly service?: readonly string[];
  readonly environment?: readonly string[];
}): string | undefined {
  if (!filter.service && !filter.environment) return undefined;
  return 'service and environment filters use hash buckets upstream and may include rare collisions.';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True when any series has a non-number point in range — never silently counted as 0. */
function hasUnavailableValue(
  series: readonly { data?: readonly unknown[] | null }[],
  length: number,
): boolean {
  return series.some((s) => (s.data ?? []).slice(0, length).some((v) => !isFiniteNumber(v)));
}

function sum(
  data: readonly unknown[] | null | undefined,
  length: number,
): { readonly total: number } {
  const total = (data ?? [])
    .slice(0, length)
    .reduce((acc: number, v) => acc + (isFiniteNumber(v) ? v : 0), 0);
  return { total };
}

function busiestBucket(
  data: readonly unknown[] | null | undefined,
  intervals: readonly string[],
  length: number,
): { readonly at: string | undefined; readonly value: number } {
  const values = (data ?? []).slice(0, length);
  let bestIndex = -1;
  let bestValue = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isFiniteNumber(v) && v > bestValue) {
      bestValue = v;
      bestIndex = i;
    }
  }
  return bestIndex === -1
    ? { at: undefined, value: 0 }
    : { at: intervals[bestIndex], value: bestValue };
}

function bucketLines(
  intervals: readonly string[],
  series: readonly { name: string; data?: readonly unknown[] | null }[],
  length: number,
  bucketing: 'hour' | 'day',
): string[] {
  if (bucketing === 'hour') {
    return intervals.map((interval, i) => {
      const counts = series
        .map((s) => {
          const v = (s.data ?? [])[i];
          return `${flatten(s.name)}=${isFiniteNumber(v) ? v : '?'}`;
        })
        .join(' ');
      return `  ${interval}  ${counts}`;
    });
  }
  const byDay = new Map<string, { sums: number[]; known: boolean[] }>();
  const order: string[] = [];
  for (let i = 0; i < length; i++) {
    const day = (intervals[i] ?? '').slice(0, 10) || '-';
    if (!byDay.has(day)) {
      byDay.set(day, { sums: series.map(() => 0), known: series.map(() => false) });
      order.push(day);
    }
    const entry = byDay.get(day) as { sums: number[]; known: boolean[] };
    series.forEach((s, si) => {
      const v = (s.data ?? [])[i];
      if (isFiniteNumber(v)) {
        entry.sums[si] += v;
        entry.known[si] = true;
      }
    });
  }
  return order.map((day) => {
    const entry = byDay.get(day) as { sums: number[]; known: boolean[] };
    const counts = series
      .map((s, si) => `${flatten(s.name)}=${entry.known[si] ? entry.sums[si] : '?'}`)
      .join(' ');
    return `  ${day}  ${counts}`;
  });
}

export function listLogResourcesView(
  resources: readonly LogResource[],
  org: string,
  type: string | undefined,
): View {
  return {
    untrusted: { field: 'resources', source: 'glitchtip-event' },
    text: () => {
      if (resources.length === 0) {
        return type
          ? `No ${type} resources recorded in ${org}.`
          : `No resources recorded in ${org}.`;
      }
      const body = table(resources, [
        { header: 'type', value: (r) => r.type },
        { header: 'lastSeen', value: (r) => iso(r.lastSeen) },
      ]);
      const [header, ...lines] = body.split('\n');
      const withName = lines.map(
        (line, i) => `${line}  ${capText(flatten(resources[i]?.name ?? ''), FIELD_CAP)}`,
      );
      const rendered = untrusted('resources', [header, ...withName].join('\n'), 'glitchtip-event');
      return resources.length >= RESOURCE_LIMIT
        ? `${rendered}\n(latest ${RESOURCE_LIMIT})`
        : rendered;
    },
    json: () => ({
      resources: resources.map((r) => ({ name: r.name, type: r.type, lastSeen: r.lastSeen })),
    }),
  };
}

function fenced(field: string, value: string | null | undefined, limit = FIELD_CAP): string {
  return untrusted(field, capText(flatten(value ?? ''), limit));
}

function capText(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function logProjection(log: LogEvent): unknown {
  return {
    id: log.id,
    timestamp: log.timestamp,
    level: log.level,
    service: log.service,
    projectId: log.projectId,
    body: log.body,
  };
}
