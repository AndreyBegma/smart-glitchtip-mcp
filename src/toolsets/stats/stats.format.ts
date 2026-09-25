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
// reconstructs the full hourly grid from the request's own start/end and fills any hour
// missing from the response with 0, borrowing the UTC offset of a neighbouring returned
// interval for the synthesized ones (the endpoint renders every interval in the server's
// fixed local timezone — spec: "the tool renders them as received... and does not convert").

const HOUR_MS = 3_600_000;
const FIELD = 'sum(quantity)';

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
  readonly values: readonly number[];
}

/** Reconstructs one value per hour from `start` to `end`, filling any gap with 0. */
export function reconstructHourlyGrid(
  response: StatsV2Response,
  start: string,
  end: string,
): HourlyGrid {
  const series = response.groups[0]?.series?.[FIELD];
  const data = Array.isArray(series) ? series : [];
  const returned = new Map<number, { iso: string; value: number }>();
  let offset: string | undefined;
  const length = Math.min(response.intervals.length, data.length);
  for (let i = 0; i < length; i++) {
    const iso = response.intervals[i];
    const instant = Date.parse(iso);
    if (Number.isNaN(instant)) continue;
    offset ??= offsetOf(iso);
    const raw = data[i];
    returned.set(truncateHour(instant), { iso, value: typeof raw === 'number' ? raw : 0 });
  }
  const fallbackOffset = offset ?? 'Z';
  const startHour = truncateHour(Date.parse(start));
  const endHour = truncateHour(Date.parse(end) + HOUR_MS);
  const hours: string[] = [];
  const values: number[] = [];
  for (let t = startHour; t <= endHour; t += HOUR_MS) {
    const found = returned.get(t);
    hours.push(found?.iso ?? formatWithOffset(t, fallbackOffset));
    values.push(found?.value ?? 0);
  }
  return { hours, values };
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

function rollupToDays(
  hours: readonly string[],
  values: readonly number[],
): Array<[string, number]> {
  const byDay = new Map<string, number>();
  const order: string[] = [];
  for (let i = 0; i < hours.length; i++) {
    const day = hours[i]?.slice(0, 10) || '-';
    if (!byDay.has(day)) {
      byDay.set(day, 0);
      order.push(day);
    }
    byDay.set(day, (byDay.get(day) as number) + values[i]);
  }
  return order.map((day) => [day, byDay.get(day) as number]);
}

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
  const buckets: Array<[string, number]> =
    args.bucket === 'hour'
      ? grid.hours.map((h, i) => [h, grid.values[i] ?? 0])
      : rollupToDays(grid.hours, grid.values);
  const total = grid.values.reduce((sum, v) => sum + v, 0);
  const peak = buckets.reduce<[string, number] | undefined>(
    (best, bucket) => (best === undefined || bucket[1] > best[1] ? bucket : best),
    undefined,
  );
  return {
    text: () => {
      const header = keyValues([
        ['category', args.category],
        ['range', `${args.start} to ${args.end}`],
        ['total', total],
        ['peak', peak ? `${peak[0]} (${peak[1]})` : '-'],
      ]);
      const lines = buckets.map(([bucket, value]) => `  ${bucket}  ${value}`);
      return `${header}\nbuckets (${args.bucket}):\n${lines.join('\n')}`;
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
