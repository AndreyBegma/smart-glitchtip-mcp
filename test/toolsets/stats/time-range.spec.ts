import { describe, expect, it } from 'vitest';
import { resolveDateTime } from '../../../src/toolsets/stats/time-range';

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

  it('rejects an RFC 2822 date and other free text that Date.parse would otherwise accept', () => {
    expect(resolveDateTime('Mon, 01 Jan 2026 00:00:00 GMT')).toBeUndefined();
    expect(resolveDateTime('January 1, 2026')).toBeUndefined();
    expect(resolveDateTime('2026/01/01T00:00:00Z')).toBeUndefined();
  });

  it('rejects a calendar date that does not exist, even though it matches the regex shape', () => {
    expect(resolveDateTime('2026-02-30T00:00:00Z')).toBeUndefined();
    expect(resolveDateTime('2026-13-01T00:00:00Z')).toBeUndefined();
    expect(resolveDateTime('2026-00-01T00:00:00Z')).toBeUndefined();
  });

  it('accepts seconds and a fractional part when present', () => {
    expect(resolveDateTime('2026-01-01T00:00:30Z')).toBe('2026-01-01T00:00:30.000Z');
    expect(resolveDateTime('2026-01-01T00:00:30.123Z')).toBe('2026-01-01T00:00:30.123Z');
  });

  it('never throws on an absurd now-<n>d, failing validation instead', () => {
    // Out of Date's representable range, but the arithmetic itself stays finite.
    expect(() => resolveDateTime('now-9999999999d', FIXED_NOW)).not.toThrow();
    expect(resolveDateTime('now-9999999999d', FIXED_NOW)).toBeUndefined();
    // Large enough that amount * UNIT_MS overflows to Infinity.
    const huge = `now-${'9'.repeat(300)}d`;
    expect(() => resolveDateTime(huge, FIXED_NOW)).not.toThrow();
    expect(resolveDateTime(huge, FIXED_NOW)).toBeUndefined();
  });
});
