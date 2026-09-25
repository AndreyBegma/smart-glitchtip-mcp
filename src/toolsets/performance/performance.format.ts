import { flatten } from '../../format/sanitize';
import { type Cell, keyValues, table, withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';

type TransactionGroup = components['schemas']['TransactionGroupSchema'];
type SpanGroup = components['schemas']['SpanGroupSchema'];
type NPlusOnePattern = components['schemas']['NPlusOnePatternSchema'];
type TransactionTrend = components['schemas']['TransactionTrendSchema'];

// Views project GlitchTip's payloads down to the fields an agent uses (D-12). Transaction
// names, span descriptions, `op` and `method` are all SDK-reported and therefore untrusted
// (D-18, spec §Untrusted text) — every list here fences its whole rows section once, not per
// cell or per row (spec §Untrusted text: "one fence per section, not one per cell"); a
// single-object detail view fences each untrusted field individually instead, since it has
// no rows to wrap. Every field read here tolerates a malformed/partial response so a bad
// payload degrades the text, never throws.

const TRANSACTION_LIST_LIMIT = 120;
const SPAN_LIST_LIMIT = 160;
/** Caps a single untrusted field so a shared response-budget cut can't land mid-fence. */
const FIELD_CAP = 2000;

/** Spec §Tools: the one sentence for every cold-storage-backed tool's empty result. */
export function coldStorageEmptyMessage(range: string): string {
  return (
    `No span data for ${range}. GlitchTip returns an empty list both when there is none ` +
    'and when its span storage is unavailable or busy — this is not proof of absence.'
  );
}

/** The same caveat, for `format: "json"`, on the same four tools (review should-fix). */
const COLD_STORAGE_JSON_NOTE =
  'GlitchTip returns an empty list both when there is none and when its span storage is ' +
  'unavailable or busy — this is not proof of absence.';

/** `<start> to <end>`, or a one-sided/upstream-default phrase when either is omitted. */
export function rangeLabel(start: string | undefined, end: string | undefined): string {
  if (start && end) return `${start} to ${end}`;
  if (start) return `${start} to now`;
  if (end) return `the default range to ${end}`;
  return 'the default range (last 7 days)';
}

// Small display guards so a malformed field degrades to "?" in text instead of printing
// "undefined"/"NaN"; `undefined`/`null` pass through so keyValues/table can still drop or
// dash a field that is legitimately absent, rather than showing "?" for it.

function num(value: unknown): number | '?' | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : '?';
}

const STRICT_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;
function iso(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' && STRICT_ISO.test(value) ? value : '?';
}

export function transactionGroupListView(page: Page<TransactionGroup>, org: string): View {
  const groups = page.items;
  return {
    untrusted: { field: 'transactions', source: 'glitchtip-event' },
    text: () => {
      if (groups.length === 0) return `No transaction groups match in ${org}.`;
      return withCursor(
        fencedRowsBlock('transactions', groups, transactionColumns, transactionSuffix),
        page.nextCursor,
      );
    },
    json: () => ({
      transactions: groups.map((g) => transactionGroupProjection(g)),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

export function transactionGroupDetailView(
  group: TransactionGroup,
  transactionGroupId: number,
): View {
  return {
    untrusted: { field: 'transaction', source: 'glitchtip-event' },
    text: () =>
      `${keyValues([
        ['id', group.id],
        ['transaction', fencedField('transaction', group.transaction, TRANSACTION_LIST_LIMIT)],
        ['op', fencedField('op', group.op)],
        ['method', fencedField('method', group.method)],
        ['project', group.project],
        ['count', num(group.count)],
        ['avgMs', num(group.avgDuration)],
        ['p50Ms', num(group.p50)],
        ['p95Ms', num(group.p95)],
        ['errorRate%', percent(group.errorRate)],
        ['errorCount', num(group.errorCount)],
        ['throughput', num(group.throughput)],
        ['firstSeen', iso(group.firstSeen)],
        ['lastSeen', iso(group.lastSeen)],
      ])}\nSpans: list_transaction_spans(${transactionGroupId}); daily trend: get_transaction_trend(${transactionGroupId}).`,
    json: () => transactionGroupProjection(group),
  };
}

/** Shared by `list_transaction_spans` and `list_span_groups` (spec: same output shape). */
export function spanGroupListView(spans: readonly SpanGroup[], emptyRange: string): View {
  return {
    untrusted: { field: 'spans', source: 'glitchtip-event' },
    text: () => {
      if (spans.length === 0) return coldStorageEmptyMessage(emptyRange);
      return fencedRowsBlock('spans', spans, spanColumns, spanSuffix);
    },
    json: () =>
      spans.length === 0
        ? emptyJson('spans', COLD_STORAGE_JSON_NOTE)
        : { spans: spans.map((s) => spanGroupProjection(s)) },
  };
}

export function transactionTrendView(rows: readonly TransactionTrend[], emptyRange: string): View {
  return {
    untrusted: { field: 'trend', source: 'glitchtip-event' },
    text: () => {
      if (rows.length === 0) return coldStorageEmptyMessage(emptyRange);
      return table(rows, [
        { header: 'date', value: (r) => day(r.date) },
        { header: 'transactions', value: (r) => num(r.transactionCount) },
        { header: 'spans', value: (r) => num(r.count) },
        { header: 'avgMs', value: (r) => num(r.avgDuration) },
        { header: 'totalMs', value: (r) => num(r.totalTime) },
      ]);
    },
    json: () =>
      rows.length === 0
        ? emptyJson('trend', COLD_STORAGE_JSON_NOTE)
        : {
            trend: rows.map((r) => ({
              date: r.date,
              transactions: r.transactionCount,
              spans: r.count,
              avgMs: r.avgDuration,
              totalMs: r.totalTime,
            })),
          },
  };
}

export function nPlusOneListView(patterns: readonly NPlusOnePattern[], emptyRange: string): View {
  return {
    untrusted: { field: 'patterns', source: 'glitchtip-event' },
    text: () => {
      if (patterns.length === 0) return coldStorageEmptyMessage(emptyRange);
      return fencedRowsBlock('patterns', patterns, patternColumns, patternSuffix);
    },
    json: () =>
      patterns.length === 0
        ? emptyJson('patterns', COLD_STORAGE_JSON_NOTE)
        : {
            patterns: patterns.map((p) => ({
              transactionName: p.transactionName,
              op: p.op,
              description: p.description,
              spansPerTxn: p.spansPerTxn,
              transactionCount: p.transactionCount,
              totalSpans: p.totalSpans,
              avgMs: p.avgDuration,
              totalMs: p.totalTime,
            })),
          },
  };
}

function emptyJson(field: string, note: string): Record<string, unknown> {
  return { [field]: [], note };
}

// Column sets (safe, non-untrusted fields only — op/method/description/name are appended as
// untrusted text after the table, inside the one fence that wraps the whole section).

const transactionColumns = [
  { header: 'id', value: (g: TransactionGroup) => g.id },
  { header: 'count', value: (g: TransactionGroup) => num(g.count) },
  { header: 'avgMs', value: (g: TransactionGroup) => num(g.avgDuration) },
  { header: 'p50Ms', value: (g: TransactionGroup) => num(g.p50) },
  { header: 'p95Ms', value: (g: TransactionGroup) => num(g.p95) },
  { header: 'errorRate%', value: (g: TransactionGroup) => percent(g.errorRate) },
  { header: 'throughput', value: (g: TransactionGroup) => num(g.throughput) },
  { header: 'lastSeen', value: (g: TransactionGroup) => iso(g.lastSeen) },
  { header: 'project', value: (g: TransactionGroup) => g.project },
];

function transactionSuffix(g: TransactionGroup | undefined): string {
  return (
    `op=${flat(g?.op)} method=${flat(g?.method)} ` +
    `transaction=${truncate(g?.transaction, TRANSACTION_LIST_LIMIT)}`
  );
}

const spanColumns = [
  { header: 'count', value: (s: SpanGroup) => num(s.count) },
  { header: 'avgMs', value: (s: SpanGroup) => num(s.avgDuration) },
  { header: 'p95Ms', value: (s: SpanGroup) => num(s.p95Duration) },
  { header: 'totalMs', value: (s: SpanGroup) => num(s.totalTime) },
];

function spanSuffix(s: SpanGroup | undefined): string {
  return `op=${flat(s?.op)} description=${truncate(s?.description, SPAN_LIST_LIMIT)}`;
}

const patternColumns = [
  { header: 'spansPerTxn', value: (p: NPlusOnePattern) => num(p.spansPerTxn) },
  { header: 'txnCount', value: (p: NPlusOnePattern) => num(p.transactionCount) },
  { header: 'totalSpans', value: (p: NPlusOnePattern) => num(p.totalSpans) },
  { header: 'avgMs', value: (p: NPlusOnePattern) => num(p.avgDuration) },
  { header: 'totalMs', value: (p: NPlusOnePattern) => num(p.totalTime) },
];

function patternSuffix(p: NPlusOnePattern | undefined): string {
  return (
    `op=${flat(p?.op)} transaction=${truncate(p?.transactionName, TRANSACTION_LIST_LIMIT)} ` +
    `description=${truncate(p?.description, SPAN_LIST_LIMIT)}`
  );
}

/**
 * Builds a table of safe columns, appends an untrusted suffix per row, and wraps the whole
 * header+rows block in exactly one fence (spec: one fence per section, not one per cell).
 */
function fencedRowsBlock<Row>(
  field: string,
  rows: readonly Row[],
  columns: ReadonlyArray<{ header: string; value: (row: Row) => Cell }>,
  suffix: (row: Row | undefined) => string,
): string {
  const body = table(rows, columns);
  const [header, ...lines] = body.split('\n');
  const withSuffix = lines.map((line, i) => `${line}  ${suffix(rows[i])}`);
  return untrusted(field, [header, ...withSuffix].join('\n'), 'glitchtip-event');
}

function transactionGroupProjection(g: TransactionGroup): unknown {
  return {
    id: g.id,
    transaction: g.transaction,
    op: g.op,
    method: g.method,
    project: g.project,
    count: g.count,
    avgMs: g.avgDuration,
    p50Ms: g.p50 ?? null,
    p95Ms: g.p95 ?? null,
    errorRatePercent: percentValue(g.errorRate),
    errorCount: g.errorCount,
    throughput: g.throughput ?? null,
    firstSeen: g.firstSeen,
    lastSeen: g.lastSeen,
  };
}

function spanGroupProjection(s: SpanGroup): unknown {
  return {
    op: s.op,
    description: s.description,
    count: s.count,
    avgMs: s.avgDuration,
    p95Ms: s.p95Duration,
    totalMs: s.totalTime,
  };
}

function fencedField(
  field: string,
  value: string | null | undefined,
  limit = FIELD_CAP,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return untrusted(field, truncate(value, limit));
}

function percent(rate: number | null | undefined): string {
  const value = percentValue(rate);
  return value === null ? '-' : String(value);
}

function percentValue(rate: number | null | undefined): number | null {
  return typeof rate === 'number' ? Math.round(rate * 10_000) / 100 : null;
}

function day(isoValue: string | null | undefined): string {
  const value = iso(isoValue);
  return value ? value.slice(0, 10) : '-';
}

function flat(text: string | null | undefined): string {
  return flatten(text ?? '');
}

/** Bounds a single field's length, independent of the whole-response budget. */
export function capText(text: string, limit = FIELD_CAP): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function truncate(text: string | null | undefined, limit: number): string {
  return capText(flatten(text ?? ''), limit);
}
