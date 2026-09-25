import { describe, expect, it } from 'vitest';
import { parseDsn } from '../../../src/toolsets/ingest/ingest.dsn';

describe('parseDsn', () => {
  it('parses the modern form with no secret', () => {
    expect(parseDsn('https://abc123@glitchtip.test/42')).toEqual({
      publicKey: 'abc123',
      projectId: 42,
      host: 'glitchtip.test',
    });
  });

  it('parses the legacy form and drops the secret', () => {
    const parsed = parseDsn('https://pub:SECRET_DSN_PART@glitchtip.test/42');
    expect(parsed).toEqual({ publicKey: 'pub', projectId: 42, host: 'glitchtip.test' });
    expect(JSON.stringify(parsed)).not.toContain('SECRET_DSN_PART');
  });

  it('parses a self-hosted path prefix before the project id', () => {
    expect(parseDsn('https://pub@glitchtip.test/sub/path/42')).toEqual({
      publicKey: 'pub',
      projectId: 42,
      host: 'glitchtip.test',
    });
  });

  it('keeps the port as part of the host', () => {
    expect(parseDsn('https://pub@glitchtip.test:8443/42')?.host).toBe('glitchtip.test:8443');
  });

  it('rejects a value with no public key', () => {
    expect(parseDsn('https://glitchtip.test/42')).toBeUndefined();
  });

  it('rejects a value whose last path segment is not numeric', () => {
    expect(parseDsn('https://pub@glitchtip.test/not-a-project-id')).toBeUndefined();
  });

  it('rejects a value with no path at all', () => {
    expect(parseDsn('https://pub@glitchtip.test')).toBeUndefined();
  });

  it('rejects text that is not a URL', () => {
    expect(parseDsn('not a dsn')).toBeUndefined();
  });

  it('rejects project id 0', () => {
    expect(parseDsn('https://pub@glitchtip.test/0')).toBeUndefined();
  });
});
