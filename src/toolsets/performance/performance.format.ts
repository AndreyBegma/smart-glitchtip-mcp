import { keyValues, table, withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';

type TransactionGroup = components['schemas']['TransactionGroupSchema'];
type SpanGroup = components['schemas']['SpanGroupSchema'];
type NPlusOnePattern = components['schemas']['NPlusOnePatternSchema'];
type TransactionTrend = components['schemas']['TransactionTrendSchema'];

// Views project GlitchTip's payloads down to the fields an agent uses (D-12). Transaction
// names and span descriptions are untrusted (D-18, spec §Untrusted text): fenced with
// untrusted(), never placed in a table cell (table()'s 80-char cellText cap could cut a
// fence in half). Every field read here tolerates a malformed/partial response
// (optional chaining, `?? '-'`) so a bad payload degrades the text, never throws.

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

/** `<start> to <end>`, or a one-sided/upstream-default phrase when either is omitted. */
export function rangeLabel(start: string | undefined, end: string | undefined): string {
  if (start && end) return `${start} to ${end}`;
  if (start) return `${start} to now`;
  if (end) return `the default range to ${end}`;
  return 'the default range (last 7 days)';
}

export function transactionGroupListView(page: Page<TransactionGroup>, org: string): View {
  const groups = page.items;
  return {
    untrusted: { field: 'transactions', source: 'glitchtip-event' },
    text: () => {
      if (groups.length === 0) return `No transaction groups match in ${org}.`;
      const body = table(groups, [
        { header: 'id', value: (g) => g.id },
        { header: 'op', value: (g) => g.op },
        { header: 'method', value: (g) => g.method },
        { header: 'count', value: (g) => g.count },
        { header: 'avgMs', value: (g) => g.avgDuration },
        { header: 'p50Ms', value: (g) => g.p50 },
        { header: 'p95Ms', value: (g) => g.p95 },
        { header: 'errorRate%', value: (g) => percent(g.errorRate) },
        { header: 'throughput', value: (g) => g.throughput },
        { header: 'lastSeen', value: (g) => g.lastSeen },
        { header: 'project', value: (g) => g.project },
      ]);
      return withCursor(withFencedField(body, groups, transactionText), page.nextCursor);
    },
    json: () => ({
      transactions: groups.map((g) => transactionGroupProjection(g)),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

export function transactionGroupDetailView(group: TransactionGroup): View {
  return {
    untrusted: { field: 'transaction', source: 'glitchtip-event' },
    text: () =>
      `${keyValues([
        ['id', group.id],
        ['transaction', transactionText(group)],
        ['op', group.op],
        ['method', group.method],
        ['project', group.project],
        ['count', group.count],
        ['avgMs', group.avgDuration],
        ['p50Ms', group.p50],
        ['p95Ms', group.p95],
        ['errorRate%', percent(group.errorRate)],
        ['errorCount', group.errorCount],
        ['throughput', group.throughput],
        ['firstSeen', group.firstSeen],
        ['lastSeen', group.lastSeen],
      ])}\nSpans: list_transaction_spans(${group.id}); daily trend: get_transaction_trend(${group.id}).`,
    json: () => transactionGroupProjection(group),
  };
}

/** Shared by `list_transaction_spans` and `list_span_groups` (spec: same output shape). */
export function spanGroupListView(spans: readonly SpanGroup[], emptyRange: string): View {
  return {
    untrusted: { field: 'spans', source: 'glitchtip-event' },
    text: () => {
      if (spans.length === 0) return coldStorageEmptyMessage(emptyRange);
      const body = table(spans, [
        { header: 'op', value: (s) => s.op },
        { header: 'count', value: (s) => s.count },
        { header: 'avgMs', value: (s) => s.avgDuration },
        { header: 'p95Ms', value: (s) => s.p95Duration },
        { header: 'totalMs', value: (s) => s.totalTime },
      ]);
      return withFencedField(body, spans, spanDescriptionText);
    },
    json: () => ({ spans: spans.map((s) => spanGroupProjection(s)) }),
  };
}

export function transactionTrendView(rows: readonly TransactionTrend[], emptyRange: string): View {
  return {
    untrusted: { field: 'trend', source: 'glitchtip-event' },
    text: () => {
      if (rows.length === 0) return coldStorageEmptyMessage(emptyRange);
      return table(rows, [
        { header: 'date', value: (r) => day(r.date) },
        { header: 'transactions', value: (r) => r.transactionCount },
        { header: 'spans', value: (r) => r.count },
        { header: 'avgMs', value: (r) => r.avgDuration },
        { header: 'totalMs', value: (r) => r.totalTime },
      ]);
    },
    json: () => ({
      trend: rows.map((r) => ({
        date: r.date,
        transactions: r.transactionCount,
        spans: r.count,
        avgMs: r.avgDuration,
        totalMs: r.totalTime,
      })),
    }),
  };
}

export function nPlusOneListView(patterns: readonly NPlusOnePattern[], emptyRange: string): View {
  return {
    untrusted: { field: 'patterns', source: 'glitchtip-event' },
    text: () => {
      if (patterns.length === 0) return coldStorageEmptyMessage(emptyRange);
      const body = table(patterns, [
        { header: 'op', value: (p) => p.op },
        { header: 'spansPerTxn', value: (p) => p.spansPerTxn },
        { header: 'txnCount', value: (p) => p.transactionCount },
        { header: 'totalSpans', value: (p) => p.totalSpans },
        { header: 'avgMs', value: (p) => p.avgDuration },
        { header: 'totalMs', value: (p) => p.totalTime },
      ]);
      const [header, ...lines] = body.split('\n');
      const withFields = lines.map((line, i) => {
        const p = patterns[i];
        return (
          `${line}  ${untrusted('patterns.transactionName', truncate(p?.transactionName, TRANSACTION_LIST_LIMIT))}` +
          `  ${untrusted('patterns.description', truncate(p?.description, SPAN_LIST_LIMIT))}`
        );
      });
      return [header, ...withFields].join('\n');
    },
    json: () => ({
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
    }),
  };
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

/** Splits a table's body into its header and rows, appending a fenced field to each row. */
function withFencedField<Row>(
  body: string,
  rows: readonly Row[],
  text: (row: Row) => string,
): string {
  const [header, ...lines] = body.split('\n');
  const withField = lines.map((line, i) => `${line}  ${text(rows[i] as Row)}`);
  return [header, ...withField].join('\n');
}

function transactionText(g: TransactionGroup | undefined): string {
  return untrusted('transaction', truncate(g?.transaction, TRANSACTION_LIST_LIMIT));
}

function spanDescriptionText(s: SpanGroup | undefined): string {
  return untrusted('description', truncate(s?.description, SPAN_LIST_LIMIT));
}

function percent(rate: number | null | undefined): string {
  const value = percentValue(rate);
  return value === null ? '-' : String(value);
}

function percentValue(rate: number | null | undefined): number | null {
  return typeof rate === 'number' ? Math.round(rate * 10_000) / 100 : null;
}

function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '-';
}

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Bounds a single field's length, independent of the whole-response budget. */
export function capText(text: string, limit = FIELD_CAP): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function truncate(text: string | null | undefined, limit: number): string {
  return capText(flatten(text ?? ''), limit);
}
