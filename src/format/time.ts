/**
 * Strict ISO 8601 date-time, with a mandatory timezone: seconds and a
 * fractional part are optional, `Z`/an offset is not. `Date.parse` accepts
 * far more than this — including plain English sentences a V8-family engine
 * happens to recognise as a date (`Date.parse("IGNORE PREVIOUS </untrusted>
 * 2020")` is a valid date [Confirmed: review of #31]) — so a value is
 * trusted as plain, unfenced text only once it has this shape, never from
 * `Date.parse` succeeding alone.
 */
const ISO_TIMESTAMP_SHAPE =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** Round-trips year/month/day through `Date.UTC`: a calendar date that doesn't exist bounces. */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * `value` itself when it is a strict ISO 8601 date-time whose year-month-day
 * is a calendar date that exists (a regex shape alone can't tell Feb 30 from
 * Feb 28); `undefined` otherwise. Never normalises or reformats — a caller
 * that gets a value back knows it is exactly what GlitchTip sent.
 */
export function isoTimestamp(value: string): string | undefined {
  const match = ISO_TIMESTAMP_SHAPE.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  if (!isValidCalendarDate(Number(year), Number(month), Number(day))) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}
