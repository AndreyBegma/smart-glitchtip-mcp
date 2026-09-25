// The stored shape of exception/breadcrumb/request data is inferred, not
// schema-backed (spec risk, "The event renderer"): every read here is
// defensive, so an unexpected payload degrades to a fallback note instead of
// throwing.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function asStringArray(value: unknown): string[] | undefined {
  const array = asArray(value);
  if (!array) return undefined;
  const strings = array.filter((item): item is string => typeof item === 'string');
  return strings.length > 0 ? strings : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** Flattens to one line and cuts to `max` characters, marking the cut. */
export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
