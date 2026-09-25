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
  it('clips the grid to the half-open [start, end) — 00:00–03:00 is three buckets (orchestrator ruling on AC7)', () => {
    const response = asStatsV2Response({ intervals: [], groups: [] });
    const grid = reconstructHourlyGrid(response, '2026-01-01T00:00:00Z', '2026-01-01T03:00:00Z');
    expect(grid.hours).toEqual([
      '2026-01-01T00:00:00Z',
      '2026-01-01T01:00:00Z',
      '2026-01-01T02:00:00Z',
    ]);
    expect(grid.values).toEqual([0, 0, 0]);
  });

  it("fills a gap hour with 0, using the nearest preceding returned interval's offset (spec §Risks)", () => {
    // The hour at index 1 (01:00) is missing from the response — GlitchTip's own gap (spec
    // §Risks: an hour with stats only for other projects vanishes from the WHERE-filtered
    // GROUP BY entirely).
    const response = asStatsV2Response({
      intervals: ['2026-01-01T00:00:00+00:00', '2026-01-01T02:00:00+00:00'],
      groups: [{ series: { 'sum(quantity)': [5, 7] } }],
    });
    const grid = reconstructHourlyGrid(response, '2026-01-01T00:00:00Z', '2026-01-01T03:00:00Z');
    expect(grid.hours).toEqual([
      '2026-01-01T00:00:00+00:00',
      '2026-01-01T01:00:00+00:00',
      '2026-01-01T02:00:00+00:00',
    ]);
    expect(grid.values).toEqual([5, 0, 7]);
  });

  it('treats a null sum (a legitimate zero from upstream) as 0', () => {
    const response = asStatsV2Response({
      intervals: ['2026-01-01T00:00:00Z'],
      groups: [{ series: { 'sum(quantity)': [null] } }],
    });
    const grid = reconstructHourlyGrid(response, '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z');
    expect(grid.values).toEqual([0]);
  });

  it('marks an hour present in intervals but missing from a too-short series as unavailable, never 0 (review should-fix, rule 7)', () => {
    const response = asStatsV2Response({
      intervals: ['2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'],
      groups: [{ series: { 'sum(quantity)': [5] } }], // series is one short of intervals
    });
    const grid = reconstructHourlyGrid(response, '2026-01-01T00:00:00Z', '2026-01-01T02:00:00Z');
    expect(grid.values).toEqual([5, null]);
  });

  it('falls back to Z when the response has no interval to borrow an offset from', () => {
    const response = asStatsV2Response({ intervals: [], groups: [] });
    const grid = reconstructHourlyGrid(response, '2026-01-01T00:00:00Z', '2026-01-01T02:00:00Z');
    for (const hour of grid.hours) expect(hour.endsWith('Z')).toBe(true);
  });
});

describe('organizationStatsView', () => {
  it('rolls a clean 72h range (acceptance 7) up to exactly three day buckets (orchestrator ruling on AC7)', () => {
    const hours = 72;
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
    expect(days).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(json.buckets.find((b) => b.bucket === '2026-01-01')?.value).toBe(24);
    expect(json.buckets.find((b) => b.bucket === '2026-01-03')?.value).toBe(24);
  });

  it('renders total and the peak bucket in text', () => {
    const raw = {
      intervals: ['2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'],
      groups: [{ series: { 'sum(quantity)': [3, 9] } }],
    };
    const view = organizationStatsView(raw, {
      category: 'transaction',
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-01T02:00:00Z',
      bucket: 'hour',
      projectIds: [1, 2],
    });
    const text = view.text();
    expect(text).toContain('total: 12');
    expect(text).toContain('2026-01-01T01:00:00Z (9)');
  });

  it('never zero-fills an unavailable bucket, and excludes it from total/peak', () => {
    const raw = {
      intervals: ['2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'],
      groups: [{ series: { 'sum(quantity)': [3] } }], // 01:00 is present in intervals, absent from series
    };
    const view = organizationStatsView(raw, {
      category: 'error',
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-01T02:00:00Z',
      bucket: 'hour',
      projectIds: undefined,
    });
    const text = view.text();
    expect(text).toContain('total: 3');
    expect(text).toContain('  2026-01-01T01:00:00Z  unavailable');
    expect(text).toContain('Some buckets are unavailable');
    const json = view.json() as { buckets: { bucket: string; value: number | null }[] };
    expect(json.buckets.find((b) => b.bucket === '2026-01-01T01:00:00Z')?.value).toBeNull();
  });
});
