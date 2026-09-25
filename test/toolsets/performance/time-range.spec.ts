import { describe, expect, it } from 'vitest';
import { resolveDateTime } from '../../../src/toolsets/performance/time-range';

// Spec §Shared input rules: `start`/`end` accept an ISO 8601 date-time with a timezone, or
// the relative forms `now` and `now-<n>m|h|d`, resolved to an ISO instant before any request
// (acceptance 6). This toolset's own copy of the shared module — see time-range.ts's header
// comment for why it is duplicated rather than imported from a sibling.

const FIXED_NOW = () => new Date('2026-06-15T12:00:00.000Z');

describe('resolveDateTime', () => {
  it('resolves "now" to the current instant', () => {
    expect(resolveDateTime('now', FIXED_NOW)).toBe('2026-06-15T12:00:00.000Z');
  });

  it('resolves now-<n>m|h|d relative to the current instant', () => {
    expect(resolveDateTime('now-30m', FIXED_NOW)).toBe('2026-06-15T11:30:00.000Z');
    expect(resolveDateTime('now-24h', FIXED_NOW)).toBe('2026-06-14T12:00:00.000Z');
    expect(resolveDateTime('now-7d', FIXED_NOW)).toBe('2026-06-08T12:00:00.000Z');
  });

  it('resolves an ISO date-time with Z or an offset to its instant', () => {
    expect(resolveDateTime('2026-01-01T00:00:00Z')).toBe('2026-01-01T00:00:00.000Z');
    expect(resolveDateTime('2026-01-01T00:00:00+02:00')).toBe('2025-12-31T22:00:00.000Z');
  });

  it('rejects a date-time with no timezone', () => {
    expect(resolveDateTime('2026-01-01T00:00:00')).toBeUndefined();
  });

  it('rejects a plain date, a word, and an out-of-range relative unit', () => {
    expect(resolveDateTime('2026-01-01')).toBeUndefined();
    expect(resolveDateTime('yesterday')).toBeUndefined();
    expect(resolveDateTime('now-1w')).toBeUndefined();
    expect(resolveDateTime('now+1h')).toBeUndefined();
  });
});
