import { z } from 'zod';

// Shared by the performance, logs and stats toolsets (spec FEAT-20260925-011 §Shared
// input rules): kept byte-identical in all three — there is no foundation home for it
// (src/mcp/**, src/format/** are outside this slot's fence) and no toolset here imports
// from a sibling. A follow-up may promote it to src/mcp/tool-params.ts.

const RELATIVE = /^now(?:-(\d+)(m|h|d))?$/;
const UNIT_MS: Record<'m' | 'h' | 'd', number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
/**
 * A strict ISO 8601 date-time: seconds and a fractional part are optional, the timezone
 * is not — `Z` or a numeric offset. Rejects a date-only string, an RFC 2822 date, and
 * anything else free-form; the hour is bounded to 00–23 (`T24:00` is refused, not silently
 * rolled to the next day); the calendar itself (Feb 30, a 13th month) is checked
 * separately, since a regex can bound digit counts but not which days a month has.
 */
const STRICT_ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

const DATE_TIME_DESCRIPTION =
  'ISO 8601 date-time with a timezone (Z or an offset), or the relative form "now" or ' +
  '"now-<n>m|h|d" (minutes, hours or days).';

/** Round-trips year/month/day through `Date.UTC`: a calendar date that doesn't exist bounces. */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Resolves `value` to an ISO instant: `now`, `now-<n>m|h|d`, or a strict ISO 8601 date-time
 * that carries an explicit timezone. `undefined` when it is neither, so every endpoint this
 * server calls sees the same absolute value whether or not it understands the relative
 * form itself (`stats_v2` does not). Never throws: an absurd `<n>` (e.g. a value that would
 * push the instant outside the range `Date` can represent) is a validation issue, not a
 * `RangeError` from `toISOString()`.
 */
export function resolveDateTime(
  value: string,
  now: () => Date = () => new Date(),
): string | undefined {
  const relative = RELATIVE.exec(value);
  if (relative) {
    const [, amount, unit] = relative;
    const instant = now();
    if (!amount || !unit) return instant.toISOString();
    const delta = Number(amount) * UNIT_MS[unit as 'm' | 'h' | 'd'];
    if (!Number.isFinite(delta)) return undefined;
    const resolved = new Date(instant.getTime() - delta);
    return Number.isNaN(resolved.getTime()) ? undefined : resolved.toISOString();
  }
  const match = STRICT_ISO.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  if (!isValidCalendarDate(Number(year), Number(month), Number(day))) return undefined;
  const parsedMs = Date.parse(value);
  return Number.isNaN(parsedMs) ? undefined : new Date(parsedMs).toISOString();
}

/** A `start`/`end` argument: validated and resolved to an ISO instant before any request. */
export function dateTimeParam(label: string) {
  return z
    .string()
    .min(1)
    .transform((value, ctx) => {
      const resolved = resolveDateTime(value);
      if (resolved === undefined) {
        ctx.addIssue({ code: 'custom', message: `${label} must be ${DATE_TIME_DESCRIPTION}` });
        return z.NEVER;
      }
      return resolved;
    })
    .describe(DATE_TIME_DESCRIPTION);
}

/** Cross-field check once `start`/`end` are resolved: rejects a range that isn't ordered. */
export function checkTimeRange(
  data: { readonly start?: string; readonly end?: string },
  ctx: z.RefinementCtx,
): void {
  if (data.start === undefined || data.end === undefined) return;
  if (Date.parse(data.start) >= Date.parse(data.end)) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'end must be after start.' });
  }
}
