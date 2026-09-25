import { flatten } from '../../format/sanitize';
import { type Column, keyValues, table, withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { Page } from '../../glitchtip/pagination';
import { MONITOR_TYPES } from './monitors.params';

// Views GlitchTip's monitor payloads down to the fields an agent uses (D-12). Name, url, project,
// environment and expectedBody are untrusted (D-18: environment is "glitchtip-event" — an
// Environment row is created lazily from whatever an event's tag names, so its name is exactly as
// trustworthy as event content; everything else here is "glitchtip-config" — set by an
// organization member, not an operator constant). Fenced with untrusted() in text output, and the
// whole json result wrapped in one fence per tool (see each view's `untrusted`).
//
// A typed field (an id, a timestamp, a monitor type) is rendered plain only when it actually has
// the shape GlitchTip's schema promises; a malformed or unexpected value degrades to a safe
// placeholder (`?`) where it appears in a table cell — table()'s 80-character-per-cell cut is not
// fence-aware, so an untrusted() tag is never embedded there — and the raw value is still shown,
// fenced, in that row's trailer. `checks` missing entirely (a malformed response) renders
// "unavailable", distinct from a monitor that legitimately has none yet; only a field of the wrong
// type that makes a view throw becomes the foundation's `malformed` tool error (BUG-20260925-006).

/** Caps a single untrusted field so a shared response-budget cut can't land mid-fence. */
export const FIELD_CAP = 2000;
const URL_LIST_CAP = 120;
const STATE_CHANGE_LIMIT = 5;

export function capText(text: string, limit = FIELD_CAP): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function truncate(text: string, limit: number): string {
  return capText(flatten(text), limit);
}

/** A check as embedded in a monitor, or returned by list_monitor_checks. */
export interface CheckLike {
  readonly startCheck: string;
  readonly isUp: boolean;
  readonly reason: number | null;
  readonly responseTime?: number | null;
}

/** The fields this toolset reads, common to MonitorSchema and MonitorDetailSchema. */
export interface MonitorLike {
  readonly id?: number | null;
  readonly name: string;
  readonly monitorType: string;
  readonly isUp: boolean | null;
  readonly lastChange: string | null;
  readonly url?: string | null;
  readonly expectedStatus: number | null;
  readonly expectedBody?: string | null;
  readonly interval: number;
  readonly timeout?: number | null;
  readonly confirmationThreshold: number;
  readonly projectID: string | null;
  readonly projectName?: string | null;
  readonly envName?: string | null;
  readonly created: string;
  readonly endpointID?: string | null;
  readonly heartbeatEndpoint: string | null;
  /** Optional here although GlitchTip's schema requires it: a malformed response can omit it. */
  readonly checks?: readonly CheckLike[];
}

/** [Confirmed: MonitorCheckReason in apps/uptime/constants.py]. */
const REASONS = [
  'unknown',
  'timeout',
  'wrong status code',
  'expected response not found',
  'SSL error',
  'network error',
] as const;

function reasonText(reason: number | null | undefined): string {
  if (typeof reason !== 'number') return '-';
  return REASONS[reason] ?? `reason ${reason}`;
}

/** Strict on both states: anything that is not literally `true`/`false` is `pending`. */
function stateText(isUp: boolean | null | undefined): 'up' | 'down' | 'pending' {
  if (isUp === true) return 'up';
  if (isUp === false) return 'down';
  return 'pending';
}

function idText(id: number | null | undefined): string {
  return typeof id === 'number' ? String(id) : '?';
}

function numberCell(value: unknown, unit = ''): string {
  return typeof value === 'number' ? `${value}${unit}` : '?';
}

function isKnownMonitorType(value: string): value is (typeof MONITOR_TYPES)[number] {
  return (MONITOR_TYPES as readonly string[]).includes(value);
}

function isParseableTime(raw: string): boolean {
  return !Number.isNaN(Date.parse(raw));
}

/**
 * Plain when `raw` actually parses as a date-time; fenced (never trusted as
 * a bare timestamp) otherwise. Safe to call anywhere the result lands in
 * unbounded text (`keyValues`); a `table()` cell needs the cell/trailer
 * split below instead, since its per-cell cut is not fence-aware.
 */
function timeText(raw: string, field: string): string {
  return isParseableTime(raw)
    ? raw
    : untrusted(field, truncate(raw, FIELD_CAP), 'glitchtip-config');
}

function upRatioText(checks: readonly CheckLike[] | undefined): string {
  if (checks === undefined) return 'unavailable';
  if (checks.length === 0) return 'no checks yet';
  const up = checks.filter((c) => c.isUp).length;
  return `up ${up}/${checks.length} (last ${checks.length} checks)`;
}

/**
 * `lastChange` is a pre-formatted string, not a typed date-time [Confirmed:
 * MonitorSchema.resolve_last_change]. Called only once `isParseableTime` has
 * already confirmed `raw` parses.
 */
function lastChangeRelative(raw: string): string {
  return `${relativeAge(Date.parse(raw))} (${raw})`;
}

function relativeAge(then: number, now = Date.now()): string {
  const diffMs = now - then;
  const abs = Math.abs(diffMs);
  const suffix = diffMs >= 0 ? 'ago' : 'from now';
  const units: readonly (readonly [string, number])[] = [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1_000],
  ];
  for (const [label, unitMs] of units) {
    if (abs >= unitMs) return `${Math.floor(abs / unitMs)}${label} ${suffix}`;
  }
  return 'just now';
}

/** Detail view (unbounded `keyValues` text): safe to fence an unparsable value inline. */
function lastChangeDetailText(raw: string | null): string {
  if (!raw) return '-';
  return isParseableTime(raw) ? lastChangeRelative(raw) : timeText(raw, 'lastChange');
}

/** List view (a `table()` cell): a safe placeholder only — the raw value goes in the trailer. */
function lastChangeCell(raw: string | null): string {
  if (!raw) return '-';
  return isParseableTime(raw) ? lastChangeRelative(raw) : '?';
}

function lastChangeNote(raw: string | null): string | undefined {
  return raw && !isParseableTime(raw)
    ? untrusted('lastChange', truncate(raw, FIELD_CAP), 'glitchtip-config')
    : undefined;
}

function timeoutText(timeout: number | null | undefined): string {
  return timeout != null ? `${timeout} s` : 'default (20 s)';
}

function urlText(monitor: MonitorLike, limit: number): string {
  if (monitor.monitorType === 'Heartbeat') return '—';
  return untrusted('url', truncate(monitor.url ?? '', limit), 'glitchtip-config');
}

/** Last 4 characters of an id, masked — nothing at all when that would reveal most of a short id. */
function maskId(id: string): string {
  return id.length <= 8 ? '…' : `…${id.slice(-4)}`;
}

function heartbeatTextLine(monitor: MonitorLike, includeUrl: boolean): string | undefined {
  if (monitor.monitorType !== 'Heartbeat') return undefined;
  const id = monitor.endpointID;
  if (!id) return 'heartbeat endpoint: not configured yet';
  if (!includeUrl) return `heartbeat endpoint: configured (id ${maskId(id)})`;
  const url = monitor.heartbeatEndpoint
    ? untrusted(
        'heartbeatEndpoint',
        truncate(monitor.heartbeatEndpoint, FIELD_CAP),
        'glitchtip-config',
      )
    : '—';
  return (
    `heartbeat endpoint: configured (id ${id})\n` +
    "This URL lets anyone mark the monitor as up; put it only into the monitored service's " +
    `configuration.\nheartbeat url: ${url}`
  );
}

function heartbeatJson(monitor: MonitorLike, includeUrl: boolean): Record<string, unknown> {
  if (monitor.monitorType !== 'Heartbeat') return {};
  const id = monitor.endpointID;
  if (!id) return { heartbeatEndpointId: null };
  if (!includeUrl) return { heartbeatEndpointId: maskId(id) };
  return { heartbeatEndpointId: id, heartbeatUrl: monitor.heartbeatEndpoint ?? null };
}

function responseTimes(checks: readonly CheckLike[]): number[] {
  return checks
    .map((c) => c.responseTime)
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
}

function average(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Up to `limit` most recent up/down transitions among `checks` (newest
 * first): a check whose `isUp` differs from the next, older one.
 */
function stateChanges(checks: readonly CheckLike[], limit: number): CheckLike[] {
  const changes: CheckLike[] = [];
  for (let i = 0; i < checks.length - 1 && changes.length < limit; i++) {
    if (checks[i].isUp !== checks[i + 1].isUp) changes.push(checks[i]);
  }
  return changes;
}

function checkSummaryText(checks: readonly CheckLike[] | undefined): string {
  if (checks === undefined) return 'checks: unavailable';
  if (checks.length === 0) return 'checks (last 0): none recorded yet';
  const last = checks[0];
  const lastLine = `last check: ${timeText(last.startCheck, 'check.time')} ${stateText(last.isUp)} (${reasonText(last.reason)})`;
  const times = responseTimes(checks);
  const timesLine = times.length
    ? `response time: avg ${Math.round(average(times))} ms, max ${Math.max(...times)} ms`
    : 'response time: unavailable';
  const changes = stateChanges(checks, STATE_CHANGE_LIMIT);
  const changesLine = changes.length
    ? `last state changes:\n${changes.map((c) => `  ${timeText(c.startCheck, 'check.time')} -> ${stateText(c.isUp)}`).join('\n')}`
    : 'last state changes: none recorded';
  return [`checks (last ${checks.length}):`, lastLine, timesLine, changesLine].join('\n');
}

function checkSummaryJson(checks: readonly CheckLike[] | undefined): Record<string, unknown> {
  if (!checks || checks.length === 0) {
    return { lastCheck: null, avgResponseTimeMs: null, maxResponseTimeMs: null, stateChanges: [] };
  }
  const last = checks[0];
  const times = responseTimes(checks);
  return {
    lastCheck: { time: last.startCheck, up: last.isUp, reason: reasonText(last.reason) },
    avgResponseTimeMs: times.length ? Math.round(average(times)) : null,
    maxResponseTimeMs: times.length ? Math.max(...times) : null,
    stateChanges: stateChanges(checks, STATE_CHANGE_LIMIT).map((c) => ({
      time: c.startCheck,
      up: c.isUp,
    })),
  };
}

function uptimeJson(
  checks: readonly CheckLike[] | undefined,
): { up: number; total: number } | null {
  if (!checks || checks.length === 0) return null;
  return { up: checks.filter((c) => c.isUp).length, total: checks.length };
}

/**
 * A table plus one untrusted-fenced trailer appended to each rendered row —
 * omitted (no extra separator) when a row's trailer is empty.
 */
function withFencedTrailer<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  trailer: (row: Row) => string,
): string {
  const body = table(rows, columns);
  const [header, ...lines] = body.split('\n');
  const withTrailers = lines.map((line, i) => {
    const note = trailer(rows[i]);
    return note ? `${line}  ${note}` : line;
  });
  return [header, ...withTrailers].join('\n');
}

function monitorRowTrailer(m: MonitorLike): string {
  const parts = [
    untrusted('name', truncate(m.name, FIELD_CAP), 'glitchtip-config'),
    urlText(m, URL_LIST_CAP),
  ];
  if (m.projectName) {
    parts.push(untrusted('project', truncate(m.projectName, FIELD_CAP), 'glitchtip-config'));
  }
  const monitorTypeNote = isKnownMonitorType(m.monitorType)
    ? undefined
    : untrusted('monitorType', truncate(m.monitorType, FIELD_CAP), 'glitchtip-config');
  if (monitorTypeNote) parts.push(monitorTypeNote);
  const lastChangeNoteText = lastChangeNote(m.lastChange);
  if (lastChangeNoteText) parts.push(lastChangeNoteText);
  return parts.join('  ');
}

export function monitorListView(page: Page<MonitorLike>, org: string): View {
  const monitors = page.items;
  return {
    untrusted: { field: 'monitors', source: 'glitchtip-config' },
    text: () => {
      if (monitors.length === 0) return `No monitors in ${org}.`;
      const body = withFencedTrailer(
        monitors,
        [
          { header: 'id', value: (m) => idText(m.id) },
          {
            header: 'monitorType',
            value: (m) => (isKnownMonitorType(m.monitorType) ? m.monitorType : '?'),
          },
          { header: 'state', value: (m) => stateText(m.isUp) },
          { header: 'lastChange', value: (m) => lastChangeCell(m.lastChange) },
          { header: 'interval', value: (m) => numberCell(m.interval, 's') },
          { header: 'uptime', value: (m) => upRatioText(m.checks) },
        ],
        monitorRowTrailer,
      );
      return withCursor(body, page.nextCursor);
    },
    json: () => ({
      monitors: monitors.map((m) => ({
        id: typeof m.id === 'number' ? m.id : null,
        name: m.name,
        monitorType: m.monitorType,
        state: stateText(m.isUp),
        lastChange: m.lastChange,
        url: m.monitorType === 'Heartbeat' ? null : (m.url ?? null),
        interval: m.interval,
        project: m.projectName ?? null,
        uptime: uptimeJson(m.checks),
      })),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

export function monitorDetailView(
  monitor: MonitorLike,
  options: { includeHeartbeatUrl: boolean },
): View {
  const checks = monitor.checks;
  return {
    untrusted: { field: 'monitor', source: 'glitchtip-config' },
    text: () => {
      const header = keyValues([
        ['id', idText(monitor.id)],
        ['name', untrusted('name', truncate(monitor.name, FIELD_CAP), 'glitchtip-config')],
        [
          'monitorType',
          isKnownMonitorType(monitor.monitorType)
            ? monitor.monitorType
            : untrusted(
                'monitorType',
                truncate(monitor.monitorType, FIELD_CAP),
                'glitchtip-config',
              ),
        ],
        ['state', stateText(monitor.isUp)],
        ['lastChange', lastChangeDetailText(monitor.lastChange)],
        ['url', urlText(monitor, FIELD_CAP)],
        ['interval', numberCell(monitor.interval, 's')],
        [
          'project',
          monitor.projectName
            ? untrusted('project', truncate(monitor.projectName, FIELD_CAP), 'glitchtip-config')
            : undefined,
        ],
        [
          'environment',
          monitor.envName
            ? untrusted('environment', truncate(monitor.envName, FIELD_CAP), 'glitchtip-event')
            : undefined,
        ],
        ['uptime', upRatioText(checks)],
        [
          'expectedStatus',
          typeof monitor.expectedStatus === 'number' ? monitor.expectedStatus : undefined,
        ],
        [
          'expectedBody',
          monitor.expectedBody
            ? untrusted(
                'expectedBody',
                truncate(monitor.expectedBody, FIELD_CAP),
                'glitchtip-config',
              )
            : undefined,
        ],
        ['timeout', timeoutText(monitor.timeout)],
        ['confirmationThreshold', numberCell(monitor.confirmationThreshold)],
        ['created', timeText(monitor.created, 'created')],
      ]);
      const heartbeat = heartbeatTextLine(monitor, options.includeHeartbeatUrl);
      const parts = [header];
      if (heartbeat) parts.push(heartbeat);
      parts.push(checkSummaryText(checks));
      parts.push('Full history: list_monitor_checks(monitor_id).');
      return parts.join('\n');
    },
    json: () => ({
      id: typeof monitor.id === 'number' ? monitor.id : null,
      name: monitor.name,
      monitorType: monitor.monitorType,
      state: stateText(monitor.isUp),
      lastChange: monitor.lastChange,
      url: monitor.monitorType === 'Heartbeat' ? null : (monitor.url ?? null),
      interval: monitor.interval,
      project: monitor.projectName ?? null,
      environment: monitor.envName ?? null,
      uptime: uptimeJson(checks),
      expectedStatus: monitor.expectedStatus,
      expectedBody: monitor.expectedBody ?? null,
      timeout: monitor.timeout ?? null,
      confirmationThreshold: monitor.confirmationThreshold,
      created: monitor.created,
      ...heartbeatJson(monitor, options.includeHeartbeatUrl),
      ...checkSummaryJson(checks),
    }),
  };
}

export function monitorChecksView(
  page: Page<CheckLike>,
  monitorId: number,
  changesOnly: boolean,
): View {
  const checks = page.items;
  return {
    text: () => {
      if (checks.length === 0) {
        return changesOnly
          ? `No state changes recorded for monitor ${monitorId}.`
          : `No checks recorded for monitor ${monitorId}.`;
      }
      const body = withFencedTrailer(
        checks,
        [
          { header: 'time', value: (c) => (isParseableTime(c.startCheck) ? c.startCheck : '?') },
          { header: 'state', value: (c) => stateText(c.isUp) },
          { header: 'reason', value: (c) => reasonText(c.reason) },
          { header: 'responseTimeMs', value: (c) => numberCell(c.responseTime) },
        ],
        (c) => (isParseableTime(c.startCheck) ? '' : timeText(c.startCheck, 'check.time')),
      );
      return withCursor(body, page.nextCursor);
    },
    json: () => ({
      monitorId,
      checks: checks.map((c) => ({
        startCheck: c.startCheck,
        up: c.isUp,
        reason: reasonText(c.reason),
        responseTimeMs: typeof c.responseTime === 'number' ? c.responseTime : null,
      })),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

/** Confirmation of a write with nothing richer to show (D-12). */
export function resultView(summary: string, data: Record<string, unknown> = {}): View {
  return {
    text: () => summary,
    json: () => ({ result: summary, ...data }),
  };
}
