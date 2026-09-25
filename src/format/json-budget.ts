/**
 * Bounds a JSON result to `budget` characters of `JSON.stringify(v, null, 2)`
 * (D-12) and keeps it valid JSON: a text cut of serialised JSON is never
 * something an agent can parse, so the value is shrunk instead.
 *
 * - Every string longer than 2000 characters, at any depth, is cut first.
 * - An array keeps its longest prefix that fits, inside a wrapper saying how
 *   many of how many were returned.
 * - An object keeps its top-level scalars (ids, status, cursors) and shrinks
 *   the largest node, at any depth, until it fits: an array is halved, an
 *   object descended into.
 * - When nothing fits, `{ truncated, hint }` remains, with the top-level
 *   scalars that still fit.
 *
 * Linear in the size of the value: sizes are computed once and kept up to
 * date by delta, never by serialising the whole value again.
 */
export function applyJsonBudget(value: unknown, budget: number): unknown {
  if (value === undefined || fits(value, budget)) return value;
  const copy = cutLongStrings(clone(value));
  if (Array.isArray(copy)) return budgetArray(copy, budget);
  if (isObject(copy)) return budgetObject(copy, budget);
  return minimal({}, budget);
}

export const JSON_BUDGET_HINT =
  'Result exceeded the response budget. Narrow the query, use cursor, or (for events) use get_event_json with path.';

const STRING_LIMIT = 2_000;
const STRING_MARK = '…[truncated]';
const INDENT = 2;

type Json = null | boolean | number | string | Json[] | JsonObject;
type JsonObject = { [key: string]: Json };
type Container = Json[] | JsonObject;

function budgetArray(items: Json[], budget: number): unknown {
  const wrapper = (k: number): JsonObject => ({
    truncated: true,
    returned: k,
    total: items.length,
    hint: JSON_BUDGET_HINT,
    items: items.slice(0, k),
  });
  // The serialised size grows with k, so the longest fitting prefix is a
  // binary search away.
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(wrapper(mid), budget)) low = mid;
    else high = mid - 1;
  }
  if (low > 0) return wrapper(low);
  const single = wrapper(1);
  // `returned` must match what is there: an item shrunk to nothing is not returned.
  if (new Shrinker(single).shrinkTo(budget) && (single.items as Json[]).length === 1) return single;
  return minimal({ returned: 0, total: items.length }, budget);
}

function budgetObject(root: JsonObject, budget: number): unknown {
  const scalars = Object.fromEntries(Object.entries(root).filter(([, v]) => isScalar(v)));
  root.truncated = true;
  root.hint = JSON_BUDGET_HINT;
  if (new Shrinker(root).shrinkTo(budget)) return root;
  return minimal(scalars, budget);
}

/**
 * Shrinks one value in place, largest node first. Every container's
 * pretty-printed size (at its own depth) is cached, and a shrink returns its
 * delta so only the path from the root to the change is updated.
 * Top-level scalars are never touched; strings are already cut.
 */
class Shrinker {
  private readonly sizes = new WeakMap<Container, number>();
  /** Per container, its shrinkable children by size; built on first visit. */
  private readonly queues = new WeakMap<Container, MaxHeap<Container>>();

  constructor(private readonly root: JsonObject) {}

  /** True once the value fits. */
  shrinkTo(budget: number): boolean {
    let total = this.size(this.root, 0);
    while (total > budget) {
      const delta = this.shrinkLargest(this.root, 0);
      if (delta === undefined) return false;
      total += delta;
    }
    // The bookkeeping is exact; one real serialisation of the (now small)
    // result guards the budget promise anyway.
    return fits(this.root, budget);
  }

  /**
   * Shrinks the largest shrinkable container below `node`; its size delta,
   * or undefined. The children wait in a max-heap: a shrunk child goes back
   * in at its new size (its old entry is stale and skipped), and a child
   * with nothing left to shrink is dropped for good — sizes only go down.
   */
  private shrinkLargest(node: Container, depth: number): number | undefined {
    const queue = this.queueOf(node, depth);
    for (let entry = queue.pop(); entry !== undefined; entry = queue.pop()) {
      const { item: child, key: size } = entry;
      if (size !== this.size(child, depth + 1)) continue;
      const delta = this.shrink(child, depth + 1);
      if (delta === undefined) continue;
      queue.push(child, size + delta);
      this.sizes.set(node, this.size(node, depth) + delta);
      return delta;
    }
    return undefined;
  }

  private queueOf(node: Container, depth: number): MaxHeap<Container> {
    let queue = this.queues.get(node);
    if (queue === undefined) {
      queue = new MaxHeap<Container>();
      for (const child of Object.values(node)) {
        if (!isScalar(child)) queue.push(child, this.size(child, depth + 1));
      }
      this.queues.set(node, queue);
    }
    return queue;
  }

  private shrink(node: Container, depth: number): number | undefined {
    if (!Array.isArray(node)) return this.shrinkLargest(node, depth);
    if (node.length === 0) return undefined;
    if (node.length === 1) {
      const inner = this.shrinkLargest(node, depth);
      if (inner !== undefined) return inner;
    }
    const before = this.size(node, depth);
    node.length = Math.floor(node.length / 2);
    this.sizes.delete(node);
    return this.size(node, depth) - before;
  }

  /** `JSON.stringify(node, null, 2).length` as it prints at `depth`, cached for containers. */
  private size(node: Json, depth: number): number {
    if (isScalar(node)) return scalarSize(node);
    const cached = this.sizes.get(node);
    if (cached !== undefined) return cached;
    const size = containerSize(node, depth, (child) => this.size(child, depth + 1));
    this.sizes.set(node, size);
    return size;
  }
}

/** A binary max-heap of items by numeric key. */
class MaxHeap<T> {
  private readonly entries: { item: T; key: number }[] = [];

  push(item: T, key: number): void {
    const entries = this.entries;
    entries.push({ item, key });
    let i = entries.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (entries[parent].key >= entries[i].key) break;
      [entries[parent], entries[i]] = [entries[i], entries[parent]];
      i = parent;
    }
  }

  pop(): { item: T; key: number } | undefined {
    const entries = this.entries;
    const top = entries[0];
    const last = entries.pop();
    if (top === undefined || last === undefined || entries.length === 0) return top;
    entries[0] = last;
    for (let i = 0; ; ) {
      const left = 2 * i + 1;
      const right = left + 1;
      let largest = i;
      if (left < entries.length && entries[left].key > entries[largest].key) largest = left;
      if (right < entries.length && entries[right].key > entries[largest].key) largest = right;
      if (largest === i) break;
      [entries[largest], entries[i]] = [entries[i], entries[largest]];
      i = largest;
    }
    return top;
  }
}

/**
 * The pretty-printed size of a container whose children print at `childSize`:
 * `[\n` + per entry (indent, [key + ": "], child, "," but the last, "\n") +
 * closing indent + `]`.
 */
function containerSize(node: Container, depth: number, childSize: (child: Json) => number): number {
  const entries = Array.isArray(node)
    ? node.map((child) => [undefined, child] as const)
    : Object.entries(node);
  if (entries.length === 0) return 2;
  let size = 2 + 1 + INDENT * depth; // brackets, the newline after the opening one, closing indent
  for (const [key, child] of entries) {
    size += INDENT * (depth + 1) + childSize(child) + 1; // indent, value, newline
    if (key !== undefined) size += JSON.stringify(key).length + 2;
  }
  return size + entries.length - 1; // commas
}

/** `JSON.stringify(value, null, 2).length`, computed without building the string. */
export function prettySize(value: unknown): number {
  const json = clone(value);
  const size = (node: Json, depth: number): number =>
    isScalar(node)
      ? scalarSize(node)
      : containerSize(node, depth, (child) => size(child, depth + 1));
  return size(json, 0);
}

function scalarSize(value: Json): number {
  return JSON.stringify(value).length;
}

/** Cuts every string longer than STRING_LIMIT, at any depth, in one pass. */
function cutLongStrings(value: Json): Json {
  if (typeof value === 'string') {
    return value.length > STRING_LIMIT
      ? `${value.slice(0, STRING_LIMIT - STRING_MARK.length)}${STRING_MARK}`
      : value;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = cutLongStrings(value[i]);
  } else if (isObject(value)) {
    for (const key of Object.keys(value)) value[key] = cutLongStrings(value[key]);
  }
  return value;
}

/** `{ truncated, hint }` plus, in order, each top-level scalar that still fits. */
function minimal(scalars: JsonObject, budget: number): unknown {
  const kept: JsonObject = {};
  for (const [key, value] of Object.entries(scalars)) {
    if (key === 'truncated' || key === 'hint') continue;
    if (fits({ ...kept, [key]: value, truncated: true, hint: JSON_BUDGET_HINT }, budget)) {
      kept[key] = value;
    }
  }
  return { ...kept, truncated: true, hint: JSON_BUDGET_HINT };
}

function fits(value: unknown, budget: number): boolean {
  return (JSON.stringify(value, null, 2) ?? '').length <= budget;
}

/** A deep copy with exactly what serialisation keeps (no undefined, no functions). */
function clone(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function isScalar(value: Json): value is null | boolean | number | string {
  return value === null || typeof value !== 'object';
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
