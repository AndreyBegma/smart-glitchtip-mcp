import { z } from 'zod';

// Shared by the performance, logs and stats toolsets (spec FEAT-20260925-011 §Shared
// input rules): kept byte-identical in all three — there is no foundation home for it
// (src/mcp/**, src/format/** are outside this slot's fence) and no toolset here imports
// from a sibling. A follow-up may promote it to src/mcp/tool-params.ts.

const RELATIVE = /^now(?:-(\d+)(m|h|d))?$/;
const UNIT_MS: Record<'m' | 'h' | 'd', number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
const HAS_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

const DATE_TIME_DESCRIPTION =
  'ISO 8601 date-time with a timezone (Z or an offset), or the relative form "now" or ' +
  '"now-<n>m|h|d" (minutes, hours or days).';

/**
 * Resolves `value` to an ISO instant: `now`, `now-<n>m|h|d`, or an ISO 8601 date-time that
 * carries an explicit timezone. `undefined` when it is neither, so every endpoint this
 * server calls sees the same absolute value whether or not it understands the relative
 * form itself (`stats_v2` does not).
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
    return new Date(
      instant.getTime() - Number(amount) * UNIT_MS[unit as 'm' | 'h' | 'd'],
    ).toISOString();
  }
  if (!HAS_TIMEZONE.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
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
  if (data.start !== undefined && data.end !== undefined && data.start >= data.end) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'end must be after start.' });
  }
}
