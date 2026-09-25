/**
 * Bounds a JSON result to `budget` characters of `JSON.stringify(v, null, 2)`
 * (D-12) and keeps it valid JSON: a text cut of serialised JSON is never
 * something an agent can parse, so the value is shrunk instead.
 *
 * - An array keeps its longest prefix that fits, inside a wrapper saying how
 *   many of how many were returned.
 * - An object keeps every top-level scalar (ids, status, cursors) and shrinks
 *   the largest node, at any depth, until it fits: an array is halved, a long
 *   string cut, an object descended into.
 * - When nothing fits, a minimal `{ truncated, hint }` remains.
 */
export function applyJsonBudget(value: unknown, budget: number): unknown {
  if (value === undefined || fits(value, budget)) return value;
  if (Array.isArray(value)) return budgetArray(value, budget);
  if (isObject(value)) return budgetObject(value, budget);
  return minimal({}, budget);
}

export const JSON_BUDGET_HINT =
  'Result exceeded the response budget. Narrow the query, use cursor, or (for events) use get_event_json with path.';

const STRING_LIMIT = 2_000;
const STRING_MARK = '…[truncated]';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Container = Json[] | { [key: string]: Json };

function budgetArray(items: unknown[], budget: number): unknown {
  const all = clone(items) as Json[];
  const wrapper = (k: number) => ({
    truncated: true,
    returned: k,
    total: all.length,
    hint: JSON_BUDGET_HINT,
    items: all.slice(0, k),
  });
  // The serialised size grows with k, so the longest fitting prefix is a
  // binary search away.
  let low = 0;
  let high = all.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(wrapper(mid), budget)) low = mid;
    else high = mid - 1;
  }
  if (low > 0) return wrapper(low);
  const single: { [key: string]: Json } = wrapper(1);
  if (shrinkUntilFits(single, budget)) return single;
  return minimal({ returned: 0, total: all.length }, budget);
}

function budgetObject(value: object, budget: number): unknown {
  const root = clone(value) as { [key: string]: Json };
  const scalars = topLevelScalars(root);
  root.truncated = true;
  root.hint = JSON_BUDGET_HINT;
  if (shrinkUntilFits(root, budget)) return root;
  return minimal(scalars, budget);
}

/** Shrinks `root` in place; true once it fits. Top-level scalars are never touched. */
function shrinkUntilFits(root: { [key: string]: Json }, budget: number): boolean {
  while (!fits(root, budget)) {
    if (!shrinkLargest(root, true)) return false;
  }
  return true;
}

/** Shrinks the largest shrinkable child of `node`; false if there is none. */
function shrinkLargest(node: Container, top: boolean): boolean {
  const children = Object.entries(node)
    .filter(([, child]) => !(top && isScalar(child)))
    .map(([key, child]) => ({ key, child, size: serialisedSize(child) }))
    .sort((a, b) => b.size - a.size);
  for (const { key, child } of children) {
    if (shrinkChild(node, key, child)) return true;
  }
  return false;
}

function shrinkChild(parent: Container, key: string, child: Json): boolean {
  if (typeof child === 'string') {
    if (child.length <= STRING_LIMIT) return false;
    (parent as Record<string, Json>)[key] =
      `${child.slice(0, STRING_LIMIT - STRING_MARK.length)}${STRING_MARK}`;
    return true;
  }
  if (Array.isArray(child)) {
    if (child.length === 0) return false;
    if (child.length === 1) {
      if (!shrinkLargest(child, false)) child.length = 0;
      return true;
    }
    child.length = Math.floor(child.length / 2);
    return true;
  }
  if (isObject(child)) return shrinkLargest(child as Container, false);
  return false;
}

function minimal(scalars: Record<string, Json>, budget: number): unknown {
  const bare = { truncated: true, hint: JSON_BUDGET_HINT };
  const withScalars = { ...scalars, ...bare };
  return fits(withScalars, budget) ? withScalars : bare;
}

function topLevelScalars(root: Record<string, Json>): Record<string, Json> {
  return Object.fromEntries(Object.entries(root).filter(([, v]) => isScalar(v)));
}

function fits(value: unknown, budget: number): boolean {
  return (JSON.stringify(value, null, 2) ?? '').length <= budget;
}

function serialisedSize(value: Json): number {
  return (JSON.stringify(value) ?? '').length;
}

/** A deep copy with exactly what serialisation keeps (no undefined, no functions). */
function clone(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function isScalar(value: Json): boolean {
  return value === null || typeof value !== 'object';
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
