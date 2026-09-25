/**
 * Bounds a tool result to `budget` characters (D-12). The cut falls on a line
 * boundary so a table never ends mid-row, and the marker says how much was
 * dropped and what to do about it.
 */
export function applyBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const total = text.length;
  const room = Math.max(0, budget - marker(total, total).length);
  const lastNewline = text.lastIndexOf('\n', room);
  const cut = lastNewline > 0 ? lastNewline : room;
  const kept = text.slice(0, cut);
  return `${kept}${marker(total - kept.length, total)}`;
}

function marker(dropped: number, total: number): string {
  return `\n… truncated ${dropped} of ${total} characters. Narrow the query or use cursor.`;
}
