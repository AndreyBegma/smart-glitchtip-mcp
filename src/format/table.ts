import { flatten } from './sanitize';
import { untrusted } from './untrusted';

export type Cell = string | number | boolean | null | undefined;

export interface Column<Row> {
  readonly header: string;
  readonly value: (row: Row) => Cell;
}

const CELL_LIMIT = 80;

/**
 * A compact aligned table for lists (D-12): one header, one line per row,
 * columns padded to the widest cell. Cells are flattened to one line and
 * bounded so a single long value cannot swallow the response budget.
 */
export function table<Row>(rows: readonly Row[], columns: readonly Column<Row>[]): string {
  const cells = rows.map((row) => columns.map((column) => cellText(column.value(row))));
  const widths = columns.map((column, i) =>
    Math.max(column.header.length, ...cells.map((line) => line[i].length)),
  );
  const line = (values: string[]) =>
    values
      .map((value, i) => (i === values.length - 1 ? value : value.padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  return [line(columns.map((c) => c.header)), ...cells.map(line)].join('\n');
}

/**
 * `key: value` lines for a single object, skipping empty values. Values are
 * flattened to one line but not shortened; the response budget bounds them.
 */
export function keyValues(entries: readonly (readonly [string, Cell])[]): string {
  return entries
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${cellText(value, Number.POSITIVE_INFINITY)}`)
    .join('\n');
}

/**
 * A cursor shown bare, so it can be pasted back into the next call as it is: base64url
 * characters plus the separators GlitchTip's own cursor uses. Anything else is fenced
 * instead of printed raw (BUG-20260925-018 item 3), the same rule `api-view.ts` applies to
 * the escape hatch's own cursor.
 */
const CURSOR_SHAPE = /^[A-Za-z0-9:._=+/-]{1,200}$/;

/** Appends the cursor line a caller passes back to get the next page. */
export function withCursor(body: string, nextCursor: string | undefined): string {
  if (!nextCursor) return body;
  const cursor = CURSOR_SHAPE.test(nextCursor) ? nextCursor : untrusted('cursor', nextCursor);
  return `${body}\nnext cursor: ${cursor}`;
}

function cellText(value: Cell, limit = CELL_LIMIT): string {
  if (value === undefined || value === null) return '-';
  const flat = flatten(String(value));
  if (flat === '') return '-';
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}
