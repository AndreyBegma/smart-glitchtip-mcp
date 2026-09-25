import { flatten } from '../../format/sanitize';
import { type UntrustedSource, untrusted } from '../../format/untrusted';

// Readers for GlitchTip values in the admin views. GlitchTip's answer is
// read as `unknown` and every field is type-checked before it is rendered:
// a missing or wrongly typed field becomes a marked gap ("?"), never a crash
// and never a value of the wrong kind in the output. Only a body that is not
// the object or list a view needs throws, as the `TypeError` the foundation
// turns into the `malformed` tool error (BUG-20260925-006).

export const GAP = '?';
export const EM_DASH = '—';

export type Fields = Readonly<Record<string, unknown>>;

/** The body as an object, or a TypeError: a structural break, not a gap. */
export function objectBody(value: unknown, what: string): Fields {
  if (!isFields(value)) throw new TypeError(`${what} is not an object`);
  return value;
}

/** The body as a list, or a TypeError: a structural break, not a gap. */
export function listBody(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${what} is not a list`);
  return value;
}

export function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string field, flattened to one line; anything else is undefined. */
export function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? flatten(value) : undefined;
}

export function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** An id GlitchTip sends as a string or a number. */
export function idText(value: unknown): string {
  const n = numberField(value);
  if (n !== undefined) return String(n);
  const s = stringField(value);
  return s && /^[A-Za-z0-9_-]+$/.test(s) ? s : GAP;
}

export function yesNo(value: unknown): string {
  const b = booleanField(value);
  return b === undefined ? GAP : b ? 'yes' : 'no';
}

/** An ISO 8601 date-time as GlitchTip writes it: date, optional time, optional zone. */
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * The date part of an ISO date-time, or a gap. Anything else is not cut to
 * ten characters: a cut would happen before redaction and could leave the
 * start of a secret that no longer matches whole.
 */
export function day(value: unknown): string {
  const iso = isoDateTime(value);
  return iso === undefined ? GAP : iso.slice(0, 10);
}

/** For json views: an ISO date-time as sent, null for anything else. */
export function jsonDateTime(value: unknown): string | null {
  return isoDateTime(value) ?? null;
}

function isoDateTime(value: unknown): string | undefined {
  return typeof value === 'string' && ISO_DATE_TIME.test(value) ? value : undefined;
}

/** A fenced string (D-18); `absent` for null, a gap for any other non-string. */
export function fenced(
  field: string,
  value: unknown,
  source: UntrustedSource,
  absent = EM_DASH,
): string {
  if (value === null) return absent;
  const s = stringField(value);
  return s === undefined ? GAP : untrusted(field, s, source);
}

/** For json views: a string flattened, null for anything else. */
export function jsonString(value: unknown): string | null {
  return stringField(value) ?? null;
}

export function jsonNumber(value: unknown): number | null {
  return numberField(value) ?? null;
}

export function jsonBoolean(value: unknown): boolean | null {
  return booleanField(value) ?? null;
}
