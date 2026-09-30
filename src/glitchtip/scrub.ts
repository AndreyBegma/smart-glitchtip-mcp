import type { Redactor } from './redactor';

/**
 * `value` with every secret the redactor knows removed from every string in
 * it — object keys included — for a parsed GlitchTip response (AGENTS.md
 * rule 1). It runs on the response, before any view: views cut fields and
 * budget their text, and a secret cut in two there would survive as a prefix
 * that no whole-secret match can find (BUG-20260930-021).
 *
 * Copy-on-write: a part with nothing to redact is returned as it is, so a
 * clean response comes back by identity. Only strings, arrays and plain
 * objects are walked; anything else (a Blob, a Date) is passed through.
 */
export function scrubSecrets<T>(value: T, redactor: Redactor): T {
  return scrub(value, redactor) as T;
}

function scrub(value: unknown, redactor: Redactor): unknown {
  if (typeof value === 'string') return redactor.redact(value);
  if (Array.isArray(value)) return scrubArray(value, redactor);
  if (isPlainObject(value)) return scrubObject(value, redactor);
  return value;
}

function scrubArray(array: readonly unknown[], redactor: Redactor): unknown[] {
  let copy: unknown[] | undefined;
  for (let i = 0; i < array.length; i++) {
    const next = scrub(array[i], redactor);
    if (next !== array[i]) {
      copy ??= array.slice();
      copy[i] = next;
    }
  }
  return copy ?? (array as unknown[]);
}

function scrubObject(object: Record<string, unknown>, redactor: Redactor): Record<string, unknown> {
  let copy: Record<string, unknown> | undefined;
  for (const key in object) {
    if (!Object.hasOwn(object, key)) continue;
    const entry = object[key];
    const nextKey = redactor.redact(key);
    const next = scrub(entry, redactor);
    if (nextKey === key && next === entry) continue;
    copy ??= { ...object };
    // A redacted key replaces the original; two keys that redact alike keep the later value.
    if (nextKey !== key) delete copy[key];
    copy[nextKey] = next;
  }
  return copy ?? object;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
