const FENCE_OPEN = '<untrusted';
const FENCE_CLOSE = '</untrusted>';

/**
 * Bounds a text tool result to `budget` characters (D-12). The cut falls on a
 * line boundary so a table never ends mid-row, and the marker says how much
 * was dropped and what to do about it.
 *
 * A cut inside an `<untrusted>` fence (D-18) closes the fence before the
 * marker, so the marker — and anything a client appends — never reads as
 * part of the fenced data. `untrusted()` escapes every `<` in the payload, so
 * each fence tag in the text is one of ours and counting them is exact.
 */
export function applyBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const total = text.length;
  const room = Math.max(0, budget - marker(total, total).length);
  let kept = keptWithin(text, room);
  let close = '';
  if (fenceOpen(kept)) {
    kept = keptWithin(text, room - FENCE_CLOSE.length);
    if (fenceOpen(kept)) close = FENCE_CLOSE;
  }
  return `${kept}${close}${marker(total - kept.length, total)}`;
}

function keptWithin(text: string, room: number): string {
  const limit = Math.max(0, room);
  const lastNewline = text.lastIndexOf('\n', limit);
  const cut = lastNewline > 0 ? lastNewline : limit;
  return withoutPartialTag(text.slice(0, cut));
}

/** A hard cut can end inside a fence tag; drop the fragment rather than leave half a tag. */
function withoutPartialTag(kept: string): string {
  const lastOpen = kept.lastIndexOf('<');
  if (lastOpen < 0 || kept.includes('>', lastOpen)) return kept;
  const fragment = kept.slice(lastOpen);
  const partial =
    FENCE_OPEN.startsWith(fragment) ||
    FENCE_CLOSE.startsWith(fragment) ||
    fragment.startsWith(FENCE_OPEN);
  return partial ? kept.slice(0, lastOpen) : kept;
}

function fenceOpen(text: string): boolean {
  return count(text, FENCE_OPEN) > count(text, FENCE_CLOSE);
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function marker(dropped: number, total: number): string {
  return `\n… truncated ${dropped} of ${total} characters. Narrow the query or use cursor.`;
}
