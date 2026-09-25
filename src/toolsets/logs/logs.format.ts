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
// `data` are untrusted (D-18, spec §Untrusted text) — fenced with untrusted(), never placed
// in a table cell. `list_logs` fences its whole rows section once, not per cell (spec §Tools:
// "one fence per section, not one per cell"); every other list here fences per row like the
// performance toolset, since it has at most one untrusted field per row.
//
// PII in log attributes (spec §PII in logs, D-20's rule applied to logs): a key whose dotted
// path (nesting, or a literal OTel-style dotted name — both look the same once joined)
// contains a sensitive segment, or matches a known compound name outright, has its value
// replaced everywhere: text and json alike. The body is never redacted — free text can't be.

const BODY_LIST_LIMIT = 300;
const BODY_DETAIL_LIMIT = 4000;
/** Caps a single untrusted field so a shared response-budget cut can't land mid-fence. */
const FIELD_CAP = 2000;
const RESOURCE_LIMIT = 100;

const REDACTED = '[redacted]';
/** A bare segment (after splitting on `.`, `_`, `-`) that makes the whole key sensitive. */
const SEGMENT_MATCH = new Set(['ip', 'cookie', 'cookies', 'authorization', 'geo']);
/** A full key not already caught by SEGMENT_MATCH alone (e.g. "client.address"). */
const EXACT_MATCH = new Set([
  'ip_address',
  'client.address',
  'remote_addr',
  'x-forwarded-for',
  'x-real-ip',
  'set-cookie',
  'proxy-authorization',
  'user.geo',
]);

/** `key` is the full dotted path from the attribute root (e.g. "user.geo.city"). Exported for its own unit tests. */
export function isSensitiveAttributeKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (EXACT_MATCH.has(lower)) return true;
  return lower.split(/[._-]/).some((segment) => SEGMENT_MATCH.has(segment));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `format: "json"`: a deep clone of `data` with every sensitive leaf value replaced in
 * place, structure kept (a plain object is always recursed into, however its own key
 * reads — `user.geo.city` and `user.geo` are each judged on their own full path). Exported
 * for its own unit tests.
 */
export function redactAttributesForJson(data: unknown): unknown {
  if (!isPlainObject(data)) return data ?? null;
  return redactObject(data, '');
}

function redactObject(record: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) out[key] = redactObject(value, path);
    else out[key] = isSensitiveAttributeKey(path) ? REDACTED : value;
  }
  return out;
}

interface FlatAttribute {
  readonly key: string;
  readonly value: string;
}

const MAX_DEPTH = 4;
const MAX_ATTRIBUTES = 50;
const VALUE_CAP = 200;

/**
 * Text rendering (`get_log`): `data` flattened to `key = value` lines, nested objects dotted
 * up to MAX_DEPTH, sensitive values redacted, at most MAX_ATTRIBUTES lines. Exported for its
 * own unit tests.
 */
export function flattenAttributes(data: unknown): {
  readonly attributes: readonly FlatAttribute[];
  readonly more: number;
} {
  const all: FlatAttribute[] = [];
  if (isPlainObject(data)) flattenInto(data, '', 1, all);
  const attributes = all.slice(0, MAX_ATTRIBUTES);
  return { attributes, more: Math.max(0, all.length - attributes.length) };
}

function flattenInto(
  record: Record<string, unknown>,
  prefix: string,
  depth: number,
  out: FlatAttribute[],
): void {
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) && depth < MAX_DEPTH) {
      flattenInto(value, path, depth + 1, out);
    } else {
      const redacted = isSensitiveAttributeKey(path);
      out.push({ key: path, value: redacted ? REDACTED : capText(displayValue(value), VALUE_CAP) });
    }
  }
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
      if (logs.length === 0)
        return `No logs match in ${org} between ${range.start} and ${range.end}.`;
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
    { header: 'timestamp', value: (l) => l.timestamp },
    { header: 'level', value: (l) => l.level },
    { header: 'service', value: (l) => l.service },
    { header: 'project', value: (l) => l.projectId },
    { header: 'logId', value: (l) => l.id },
  ]);
  const [header, ...lines] = body.split('\n');
  const withBody = lines.map(
    (line, i) => `${line}  ${flatten(logs[i]?.body ?? '', BODY_LIST_LIMIT)}`,
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
  return {
    untrusted: { field: 'log', source: 'glitchtip-event' },
    text: () =>
      `${keyValues([
        ['id', log.id],
        ['timestamp', log.timestamp],
        ['level', log.level],
        ['project', log.projectId],
        ['service', fenced('service', log.service)],
        ['environment', fenced('environment', log.environment)],
        ['host', fenced('host', log.host)],
        ['traceID', log.traceID],
        ['spanID', fenced('spanID', log.spanID)],
        ['severityNumber', log.severityNumber],
        ['body', fenced('body', log.body, BODY_DETAIL_LIMIT)],
      ])}\nattributes:\n${attributeLines.length > 0 ? attributeLines.join('\n') : '  (none)'}`,
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
  return {
    untrusted: { field: 'log_stats', source: 'glitchtip-event' },
    text: () => {
      const note = hashBucketNoteText(hashBucketNote);
      if (intervals.length === 0 || series.length === 0) {
        const empty = `No log activity in the requested range (${range.start} to ${range.end}).`;
        return note ? `${empty}\n${note}` : empty;
      }
      const totals = series.map((s) => ({ name: s.name, total: sum(s.data, safeLength) }));
      const busiest = series.map((s) => ({
        name: s.name,
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
      lines.push(`buckets (${bucketing}):`);
      lines.push(...bucketLines(intervals.slice(0, safeLength), series, safeLength, bucketing));
      return lines.join('\n');
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

function sum(data: readonly number[] | null | undefined, length: number): number {
  return (data ?? []).slice(0, length).reduce((acc, v) => acc + (typeof v === 'number' ? v : 0), 0);
}

function busiestBucket(
  data: readonly number[] | null | undefined,
  intervals: readonly string[],
  length: number,
): { readonly at: string | undefined; readonly value: number } {
  const values = (data ?? []).slice(0, length);
  let bestIndex = -1;
  let bestValue = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = typeof values[i] === 'number' ? values[i] : 0;
    if (v > bestValue) {
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
  series: readonly { name: string; data?: readonly number[] | null }[],
  length: number,
  bucketing: 'hour' | 'day',
): string[] {
  if (bucketing === 'hour') {
    return intervals.map((interval, i) => {
      const counts = series.map((s) => `${s.name}=${(s.data ?? [])[i] ?? 0}`).join(' ');
      return `  ${interval}  ${counts}`;
    });
  }
  const byDay = new Map<string, number[]>();
  const order: string[] = [];
  for (let i = 0; i < length; i++) {
    const day = (intervals[i] ?? '').slice(0, 10) || '-';
    if (!byDay.has(day)) {
      byDay.set(
        day,
        series.map(() => 0),
      );
      order.push(day);
    }
    const totals = byDay.get(day) as number[];
    series.forEach((s, si) => {
      totals[si] += typeof (s.data ?? [])[i] === 'number' ? ((s.data as number[])[i] as number) : 0;
    });
  }
  return order.map((day) => {
    const totals = byDay.get(day) as number[];
    const counts = series.map((s, si) => `${s.name}=${totals[si]}`).join(' ');
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
        { header: 'lastSeen', value: (r) => r.lastSeen },
      ]);
      const [header, ...lines] = body.split('\n');
      const withName = lines.map((line, i) => `${line}  ${fenced('name', resources[i]?.name)}`);
      const rendered = [header, ...withName].join('\n');
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
  return untrusted(field, flatten(value ?? '', limit));
}

function flatten(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}…` : collapsed;
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
    body: capText(log.body ?? '', BODY_LIST_LIMIT),
  };
}
