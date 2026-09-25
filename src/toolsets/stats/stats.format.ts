import { keyValues } from '../../format/table';
import type { View } from '../../format/tool-output';

// get_organization_stats declares no untrusted field (spec §Untrusted text): numbers and
// timestamps only, nothing an application submitted.
//
// The response has no schema in the OpenAPI snapshot ("reverse engineered endpoint"); its
// real shape, read from GlitchTip's own source (apps/stats/api.py, `stats_v2`):
//   { intervals: string[], groups: [{ series: { "sum(quantity)": (number | null)[] } }] }
// one group/series since this tool always sends one `field`. `intervals` is not guaranteed
// gap-free: the endpoint's SQL is `generate_series(...) LEFT JOIN ... WHERE project_id =
// ANY(project_ids) OR stat IS NULL`, so an hour where matching rows exist only for *other*
// projects on the instance has every row filtered out by that WHERE clause and the whole
// GROUP BY bucket for that hour vanishes from the response (spec §Risks). This module
// reconstructs the full hourly grid for the half-open range `[start, end)` and fills any
// hour *missing from `intervals` entirely* with 0 — the correct count for the requested
// projects, per the spec. An hour that IS present in `intervals` but whose series value is
// missing (the series array is shorter, a genuinely malformed response rather than the
// documented gap above) is marked unavailable instead: a different kind of absence, and
// confidently reporting it as 0 would be a false "no events" (review should-fix, rule 7 —
// an empty result and a failure must not look alike). Ruling on the grid's own boundary
// (review): `[start, end)` in whole hours — 00:00–03:00 is three buckets, not four; this
// server does not reproduce the endpoint's own internal `end + 1h` SQL boundary, which has
// no user-facing meaning of its own.

const HOUR_MS = 3_600_000;
const FIELD = 'sum(quantity)';
/**
 * GlitchTip always builds an interval as `datetime.astimezone().replace(microsecond=0)
 * .isoformat()` (`apps/stats/api.py`) — seconds are always present, never a bare "Z" for a
 * whole minute. A response entry that doesn't match this shape is a structural surprise,
 * not something `Date.parse` should be trusted to interpret loosely (it accepts far more
 * than ISO 8601, including formats GlitchTip would never send).
 */
const STRICT_INTERVAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** `null` marks a genuinely unavailable bucket — never confused with a known 0. */
type BucketValue = number | null;

interface StatsV2Response {
  readonly intervals: readonly string[];
  readonly groups: ReadonlyArray<{ readonly series?: Readonly<Record<string, unknown>> }>;
}

/**
 * Validates the one structural invariant this server relies on (`intervals` is an array);
 * anything else about the shape is tolerated and degraded by `reconstructHourlyGrid`. A
 * response that fails this throws, which `ToolOutput` turns into the `malformed` message
 * (AGENTS.md rule 7) — never silently.
 */
export function asStatsV2Response(value: unknown): StatsV2Response {
  const record = value as { intervals?: unknown; groups?: unknown } | null | undefined;
  if (!record || !Array.isArray(record.intervals)) {
    throw new TypeError('stats_v2 response has no intervals array.');
  }
  return {
    intervals: record.intervals as string[],
    groups: Array.isArray(record.groups) ? (record.groups as StatsV2Response['groups']) : [],
  };
}

export interface HourlyGrid {
  readonly hours: readonly string[];
  readonly values: readonly BucketValue[];
}

/**
 * One value per hour over `[start, end)`. A hour absent from `intervals` is the documented
 * upstream gap and becomes 0; an hour present in `intervals` whose series value is missing
 * (index beyond a too-short series array) becomes `null` — unavailable, not zero.
 */
export function reconstructHourlyGrid(
  response: StatsV2Response,
  start: string,
  end: string,
): HourlyGrid {
  const series = response.groups[0]?.series?.[FIELD];
  const data = Array.isArray(series) ? series : [];
  const returned = new Map<number, { iso: string; value: BucketValue }>();
  for (let i = 0; i < response.intervals.length; i++) {
    const iso = response.intervals[i];
    if (!STRICT_INTERVAL_ISO.test(iso)) continue;
    const instant = Date.parse(iso);
    const value: BucketValue =
      i < data.length ? (typeof data[i] === 'number' ? (data[i] as number) : 0) : null;
    returned.set(truncateHour(instant), { iso, value });
  }
  const startHour = truncateHour(Date.parse(start));
  // Rounded UP: a range ending mid-hour (00:10–00:50, or 00:00–02:30) still owns the hour
  // it ends inside — 00:10–00:50 is one bucket, not zero; 00:00–02:30 includes 02:00–02:30
  // as its own bucket (review should-fix). An `end` already on the hour is unaffected:
  // Math.ceil of an exact multiple is that multiple.
  const endHour = Math.ceil(Date.parse(end) / HOUR_MS) * HOUR_MS;
  const hours: string[] = [];
  const values: BucketValue[] = [];
  // Seeded from the first returned interval, not a bare "Z" default, so a gap before any
  // real data still renders in the server's own timezone rather than an assumed UTC.
  let lastOffset = firstReturnedOffset(returned) ?? 'Z';
  for (let t = startHour; t < endHour; t += HOUR_MS) {
    const found = returned.get(t);
    if (found) {
      lastOffset = offsetOf(found.iso);
      hours.push(found.iso);
      values.push(found.value);
    } else {
      hours.push(formatWithOffset(t, lastOffset));
      values.push(0);
    }
  }
  return { hours, values };
}

/** The offset of the chronologically earliest returned interval, if there is one. */
function firstReturnedOffset(
  returned: ReadonlyMap<number, { iso: string; value: BucketValue }>,
): string | undefined {
  if (returned.size === 0) return undefined;
  const earliest = Math.min(...returned.keys());
  return offsetOf((returned.get(earliest) as { iso: string }).iso);
}

function truncateHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

function offsetOf(iso: string): string {
  const match = /(Z|[+-]\d{2}:?\d{2})$/.exec(iso);
  return match ? match[1] : 'Z';
}

function offsetMinutes(offset: string): number {
  if (offset === 'Z') return 0;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** The wall-clock ISO string of instant `ms`, rendered with `offset` (as the server would). */
function formatWithOffset(ms: number, offset: string): string {
  const local = new Date(ms + offsetMinutes(offset) * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
  return `${date}T${time}${offset}`;
}

/** A day is unavailable only when every hour in it is; a mix sums just the known hours. */
function rollupToDays(
  hours: readonly string[],
  values: readonly BucketValue[],
): Array<[string, BucketValue]> {
  const sums = new Map<string, number>();
  const known = new Map<string, boolean>();
  const order: string[] = [];
  for (let i = 0; i < hours.length; i++) {
    const day = hours[i]?.slice(0, 10) || '-';
    if (!sums.has(day)) {
      sums.set(day, 0);
      known.set(day, false);
      order.push(day);
    }
    const value = values[i];
    if (value !== null) {
      sums.set(day, (sums.get(day) as number) + value);
      known.set(day, true);
    }
  }
  return order.map((day) => [day, known.get(day) ? (sums.get(day) as number) : null]);
}

function num(value: unknown): number | '?' {
  return typeof value === 'number' && Number.isFinite(value) ? value : '?';
}

const bucketText = (value: BucketValue): string => (value === null ? 'unavailable' : String(value));

export function organizationStatsView(
  raw: unknown,
  args: {
    readonly category: 'error' | 'transaction';
    readonly start: string;
    readonly end: string;
    readonly bucket: 'hour' | 'day';
    readonly projectIds: readonly number[] | undefined;
  },
): View {
  const grid = reconstructHourlyGrid(asStatsV2Response(raw), args.start, args.end);
  const buckets: Array<[string, BucketValue]> =
    args.bucket === 'hour'
      ? grid.hours.map((h, i): [string, BucketValue] => [h, grid.values[i] ?? null])
      : rollupToDays(grid.hours, grid.values);
  const knownValues = grid.values.filter((v): v is number => v !== null);
  const total = knownValues.reduce((sum, v) => sum + v, 0);
  const peak = buckets.reduce<[string, number] | undefined>((best, [bucket, value]) => {
    if (value === null) return best;
    return best === undefined || value > best[1] ? [bucket, value] : best;
  }, undefined);
  const anyUnavailable = grid.values.some((v) => v === null);
  return {
    text: () => {
      const header = keyValues([
        ['category', args.category],
        ['range', `${args.start} to ${args.end}`],
        ['total', num(total)],
        ['peak', peak ? `${peak[0]} (${peak[1]})` : '-'],
      ]);
      const lines = buckets.map(([bucket, value]) => `  ${bucket}  ${bucketText(value)}`);
      const note = anyUnavailable
        ? '\nSome buckets are unavailable (the response did not carry a value for them) — not the same as a known 0.'
        : '';
      return `${header}\nbuckets (${args.bucket}):\n${lines.join('\n')}${note}`;
    },
    json: () => ({
      category: args.category,
      start: args.start,
      end: args.end,
      projectIds: args.projectIds ?? null,
      bucket: args.bucket,
      total,
      peak: peak ? { bucket: peak[0], value: peak[1] } : null,
      buckets: buckets.map(([bucket, value]) => ({ bucket, value })),
    }),
  };
}
