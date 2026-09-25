import { describe, expect, it } from 'vitest';
import { applyJsonBudget, JSON_BUDGET_HINT, prettySize } from './json-budget';

// BUG-20260925-006 acceptance 1: JSON under the budget stays valid JSON.

const size = (value: unknown) => JSON.stringify(value, null, 2).length;

describe('applyJsonBudget', () => {
  it('returns a value that fits unchanged', () => {
    const value = { a: [1, 2, 3], b: 'x' };
    expect(applyJsonBudget(value, 1_000)).toBe(value);
  });

  it('keeps the longest fitting prefix of an array, with returned and total', () => {
    const items = Array.from({ length: 300 }, (_, i) => ({ slug: `org-${i}`, name: `Org ${i}` }));
    const out = applyJsonBudget(items, 2_000) as {
      truncated: boolean;
      returned: number;
      total: number;
      hint: string;
      items: unknown[];
    };
    expect(size(out)).toBeLessThanOrEqual(2_000);
    expect(out).toMatchObject({ truncated: true, total: 300, hint: JSON_BUDGET_HINT });
    expect(out.returned).toBe(out.items.length);
    expect(out.items).toEqual(items.slice(0, out.returned));
    const oneMore = { ...out, returned: out.returned + 1, items: items.slice(0, out.returned + 1) };
    expect(size(oneMore)).toBeGreaterThan(2_000);
  });

  it('budgets the first item when not even one fits', () => {
    const items = [{ id: 1, blob: 'z'.repeat(10_000) }];
    const out = applyJsonBudget(items, 3_000) as {
      returned: number;
      items: { id: number; blob: string }[];
    };
    expect(size(out)).toBeLessThanOrEqual(3_000);
    expect(out.returned).toBe(1);
    expect(out.items[0].id).toBe(1);
    expect(out.items[0].blob).toMatch(/…\[truncated\]$/);
  });

  it('shrinks a large array property and marks the object truncated', () => {
    const value = { status: 'ok', events: Array.from({ length: 500 }, (_, i) => ({ i })) };
    const out = applyJsonBudget(value, 2_000) as typeof value & { truncated: boolean };
    expect(size(out)).toBeLessThanOrEqual(2_000);
    expect(out.truncated).toBe(true);
    expect(out.status).toBe('ok');
    expect(out.events.length).toBeGreaterThan(0);
    expect(out.events).toEqual(value.events.slice(0, out.events.length));
  });

  it('shrinks an array three levels deep and keeps the top-level status and nextCursor', () => {
    const value = {
      status: 'resolved',
      nextCursor: '100:1:0',
      a: { b: { c: Array.from({ length: 1_000 }, (_, i) => `row ${i}`) }, small: 1 },
    };
    const out = applyJsonBudget(value, 3_000) as typeof value & {
      truncated: boolean;
      hint: string;
    };
    expect(size(out)).toBeLessThanOrEqual(3_000);
    expect(out).toMatchObject({ status: 'resolved', nextCursor: '100:1:0', truncated: true });
    expect(out.hint).toBe(JSON_BUDGET_HINT);
    expect(out.a.small).toBe(1);
    expect(out.a.b.c.length).toBeGreaterThan(0);
    expect(out.a.b.c.length).toBeLessThan(1_000);
  });

  it('cuts a long nested string to end with …[truncated]', () => {
    const out = applyJsonBudget({ id: 7, detail: { text: 'q'.repeat(50_000) } }, 4_000) as {
      detail: { text: string };
    };
    expect(out.detail.text).toHaveLength(2_000);
    expect(out.detail.text.endsWith('…[truncated]')).toBe(true);
  });

  it('returns the minimal wrapper when nothing fits', () => {
    // The top-level scalars that fit stay; a long top-level string that still
    // does not fit after its cut is dropped, not the whole set.
    expect(
      applyJsonBudget({ id: 3, huge: 'x'.repeat(5_000), nextCursor: 'c1', status: 'ok' }, 1_000),
    ).toStrictEqual({
      id: 3,
      nextCursor: 'c1',
      status: 'ok',
      truncated: true,
      hint: JSON_BUDGET_HINT,
    });
    expect(applyJsonBudget('y'.repeat(5_000), 100)).toStrictEqual({
      truncated: true,
      hint: JSON_BUDGET_HINT,
    });
    // Nothing shrinkable (only nested numbers): the top-level scalars that fit remain.
    const meta = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
    expect(applyJsonBudget({ id: 3, meta }, 250)).toStrictEqual({
      id: 3,
      truncated: true,
      hint: JSON_BUDGET_HINT,
    });
    expect(applyJsonBudget('y'.repeat(5_000), 1_000)).toEqual({
      truncated: true,
      hint: JSON_BUDGET_HINT,
    });
  });

  it('cuts a long top-level string and keeps it when that fits', () => {
    const out = applyJsonBudget(
      { id: 1, message: 'm'.repeat(10_000), list: Array(10).fill(1) },
      3_000,
    ) as { id: number; message: string; truncated: boolean };
    expect(out.id).toBe(1);
    expect(out.message).toHaveLength(2_000);
    expect(out.message.endsWith('…[truncated]')).toBe(true);
    expect(out.truncated).toBe(true);
  });

  it('never reports returned: 1 with an emptied item', () => {
    // A single item whose only content is a list of numbers that cannot fit.
    const items = [{ values: Array.from({ length: 2_000 }, (_, i) => i) }];
    const out = applyJsonBudget(items, 300) as { returned: number; items?: unknown[] };
    if (out.items === undefined) expect(out.returned).toBe(0);
    else expect(out.returned).toBe(out.items.length);
    const empty = applyJsonBudget([Array.from({ length: 500 }, () => 7)], 200) as {
      returned: number;
      total: number;
      items?: unknown[];
    };
    expect(empty).toMatchObject({ returned: 0, total: 1, truncated: true });
    expect(empty.items).toBeUndefined();
  });

  it('prettySize equals the length of the pretty-printed JSON', () => {
    const random = seeded(7);
    for (let run = 0; run < 200; run++) {
      const value = randomJson(random, 0);
      expect(prettySize(value), `run ${run}`).toBe(JSON.stringify(value, null, 2).length);
    }
    expect(prettySize({ a: [], b: {}, 'k"ey': [{ x: null }] })).toBe(
      JSON.stringify({ a: [], b: {}, 'k"ey': [{ x: null }] }, null, 2).length,
    );
  });

  it('budgets a 6 MB nested object in under 200 ms (linear, not quadratic)', () => {
    const big = {
      status: 'ok',
      nextCursor: 'c9',
      extra: Object.fromEntries(
        Array.from({ length: 2_000 }, (_, i) => [`k${i}`, 's'.repeat(3_000)]),
      ),
      data: {
        rows: Array.from({ length: 5_000 }, (_, i) => ({
          i,
          tags: [1, 2, 3],
          text: 't'.repeat(40),
        })),
        nested: Array.from({ length: 300 }, () => ({ inner: [1, 2, 3, 4, 5, 6, 7, 8] })),
      },
    };
    expect(JSON.stringify(big).length).toBeGreaterThan(6_000_000);
    const start = performance.now();
    const out = applyJsonBudget(big, 20_000);
    const elapsed = performance.now() - start;
    expect(JSON.stringify(out, null, 2).length).toBeLessThanOrEqual(20_000);
    expect(out).toMatchObject({ status: 'ok', nextCursor: 'c9', truncated: true });
    expect(elapsed).toBeLessThan(200);
  });

  it('budgets thousands of shrinkable siblings in under 200 ms (no per-step sort)', () => {
    const wide = {
      status: 'ok',
      groups: Object.fromEntries(
        Array.from({ length: 600 }, (_, i) => [`g${i}`, Array.from({ length: 300 }, () => i)]),
      ),
    };
    // 600 arrays of 300: thousands of halving steps, each choosing among 600
    // siblings (a per-step sort took ~1 s on a shape like this).
    expect(JSON.stringify(wide).length).toBeGreaterThan(500_000);
    const start = performance.now();
    const out = applyJsonBudget(wide, 20_000) as {
      status: string;
      groups: Record<string, number[]>;
    };
    const elapsed = performance.now() - start;
    expect(JSON.stringify(out, null, 2).length).toBeLessThanOrEqual(20_000);
    expect(out.status).toBe('ok');
    expect(Object.keys(out.groups)).toHaveLength(600);
    expect(elapsed).toBeLessThan(200);
  });

  it('overwrites a truncated or hint key of the value itself', () => {
    const out = applyJsonBudget({ truncated: 'no', hint: 'x', list: Array(500).fill(1) }, 1_000);
    expect(out).toMatchObject({ truncated: true, hint: JSON_BUDGET_HINT });
  });

  it('property: every output parses and fits, over random sizes and depths', () => {
    const random = seeded(20260925);
    for (let run = 0; run < 300; run++) {
      const value = randomJson(random, 0);
      const budget = 400 + Math.floor(random() * 6_000);
      const out = applyJsonBudget(value, budget);
      const text = JSON.stringify(out, null, 2) ?? '';
      expect(() => JSON.parse(text), `run ${run}`).not.toThrow();
      expect(text.length, `run ${run} budget ${budget}`).toBeLessThanOrEqual(budget);
    }
  });
});

function randomJson(random: () => number, depth: number): unknown {
  const pick = random();
  if (depth > 4 || pick < 0.3) return scalar(random);
  if (pick < 0.65) {
    // Wide at the top, narrow below, so a value stays in the tens of kilobytes.
    const width = depth === 0 ? 200 : 12;
    return Array.from({ length: Math.floor(random() * width) }, () =>
      randomJson(random, depth + 1),
    );
  }
  const object: Record<string, unknown> = {};
  const keys = Math.floor(random() * 6);
  for (let k = 0; k < keys; k++) object[`k${k}`] = randomJson(random, depth + 1);
  return object;
}

function scalar(random: () => number): unknown {
  const pick = random();
  if (pick < 0.2) return null;
  if (pick < 0.4) return Math.floor(random() * 1e6);
  if (pick < 0.5) return random() < 0.5;
  // Short strings mostly, and now and then one past the 2000-character cut.
  const length = random() < 0.05 ? 2_000 + Math.floor(random() * 8_000) : Math.floor(random() * 40);
  return 'é<&"'.repeat(Math.ceil(length / 4)).slice(0, length);
}

/** mulberry32: a deterministic PRNG, so a failing run can be replayed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
