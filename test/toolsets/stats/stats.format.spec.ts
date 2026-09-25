import { describe, expect, it } from 'vitest';
import {
  asStatsV2Response,
  organizationStatsView,
  reconstructHourlyGrid,
} from '../../../src/toolsets/stats/stats.format';

// Acceptance 7: get_organization_stats always sends interval=1h and field=sum(quantity)
// (tested at the tool level, reads.spec.ts); here, the grid reconstruction itself — a
// 72h range rolled to 3 days, and a missing hour filled with 0 — read from GlitchTip's own
// source (apps/stats/api.py), since the response has no schema in the OpenAPI snapshot.

describe('asStatsV2Response', () => {
  it('throws when intervals is not an array (structural break)', () => {
    expect(() => asStatsV2Response({ intervals: 'oops', groups: [] })).toThrow(TypeError);
    expect(() => asStatsV2Response(null)).toThrow(TypeError);
    expect(() => asStatsV2Response('oops')).toThrow(TypeError);
  });

  it('tolerates a missing or malformed groups field', () => {
    expect(asStatsV2Response({ intervals: [] })).toEqual({ intervals: [], groups: [] });
    expect(asStatsV2Response({ intervals: [], groups: 'oops' })).toEqual({
      intervals: [],
      groups: [],
    });
  });
});

describe('reconstructHourlyGrid', () => {
  it("fills a gap hour with 0, using a neighbour interval's offset (spec §Risks)", () => {
    // The hour at index 1 (01:00) is missing from the response — GlitchTip's own gap (spec
    // §Risks: an hour with stats only for other projects vanishes from the WHERE-filtered
    // GROUP BY entirely).
    const response = asStatsV2Response({
      intervals: ['2026-01-01T00:00:00+00:00', '2026-01-01T02:00:00+00:00'],
      groups: [{ series: { 'sum(quantity)': [5, 7] } }],
    });
    const grid = reconstructHourlyGrid(response, '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z');
    expect(grid.hours).toEqual([
      '2026-01-01T00:00:00+00:00',
      '2026-01-01T01:00:00+00:00',
      '2026-01-01T02:00:00+00:00',
    ]);
    expect(grid.values).toEqual([5, 0, 7]);
  });

  it('treats a null sum as 0', () => {
    const response = asStatsV2Response({
      intervals: ['2026-01-01T00:00:00Z'],
      groups: [{ series: { 'sum(quantity)': [null] } }],
    });
    const grid = reconstructHourlyGrid(response, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    expect(grid.values).toEqual([0, 0]);
  });

  it('reproduces the +1h end boundary the endpoint itself applies before truncating, falling back to Z with no interval to borrow an offset from', () => {
    // start truncated down; end pushed forward one hour, then truncated down (apps/stats/api.py
    // §stats_v2: `(filters.end + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)`).
    const response = asStatsV2Response({ intervals: [], groups: [] });
    const grid = reconstructHourlyGrid(response, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    expect(grid.hours).toEqual(['2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z']);
    expect(grid.values).toEqual([0, 0]);
  });
});

describe('organizationStatsView', () => {
  it("rolls a 72h range (acceptance 7) up to day buckets, three full plus the endpoint's own trailing partial hour", () => {
    // start..end is exactly 72h, but the endpoint always adds one hour to `end` before
    // truncating (apps/stats/api.py, confirmed above), so the grid this server reconstructs
    // faithfully carries that same trailing hour into a fourth, 2-hour bucket.
    const hours = 74;
    const intervals = Array.from({ length: hours }, (_, i) =>
      new Date(Date.parse('2026-01-01T00:00:00Z') + i * 3_600_000).toISOString(),
    );
    const values = intervals.map(() => 1);
    const raw = { intervals, groups: [{ series: { 'sum(quantity)': values } }] };
    const view = organizationStatsView(raw, {
      category: 'error',
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-04T00:00:00Z',
      bucket: 'day',
      projectIds: undefined,
    });
    const json = view.json() as { buckets: { bucket: string; value: number }[]; total: number };
    expect(json.total).toBe(hours);
    const days = json.buckets.map((b) => b.bucket);
    expect(days).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
    expect(json.buckets.find((b) => b.bucket === '2026-01-01')?.value).toBe(24);
    expect(json.buckets.find((b) => b.bucket === '2026-01-04')?.value).toBe(2);
  });

  it('renders total and the peak bucket in text', () => {
    const raw = {
      intervals: ['2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'],
      groups: [{ series: { 'sum(quantity)': [3, 9] } }],
    };
    const view = organizationStatsView(raw, {
      category: 'transaction',
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-01T01:00:00Z',
      bucket: 'hour',
      projectIds: [1, 2],
    });
    const text = view.text();
    expect(text).toContain('total: 12');
    expect(text).toContain('2026-01-01T01:00:00Z (9)');
  });
});
