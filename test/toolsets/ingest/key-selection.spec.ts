import { describe, expect, it } from 'vitest';
import { selectKey } from '../../../src/toolsets/ingest/ingest.key-selection';

const ORIGIN = 'https://glitchtip.test';

function key(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: null,
    label: 'default',
    dateCreated: '2026-01-01T00:00:00Z',
    dsn: {},
    public: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    projectID: 42,
    ...overrides,
  };
}

describe('selectKey', () => {
  it('picks the sole key when neither key_id nor dsn is given', () => {
    const result = selectKey([key()], 'acme', 'web', {}, ORIGIN);
    expect(result).toMatchObject({ ok: true, key: { id: key().id, projectID: 42 } });
  });

  it('refuses with no keys', () => {
    const result = selectKey([], 'acme', 'web', {}, ORIGIN);
    expect(result).toEqual({ ok: false, message: 'acme/web has no client keys.' });
  });

  it('lists id | label and asks for key_id when several keys exist', () => {
    const a = key({ id: 'a', label: 'A' });
    const b = key({ id: 'b', label: 'B' });
    const result = selectKey([a, b], 'acme', 'web', {}, ORIGIN);
    expect(result).toEqual({
      ok: false,
      message:
        'Several client keys exist for acme/web: ' +
        'a | <untrusted source="glitchtip-config" field="key.label">A</untrusted>; ' +
        'b | <untrusted source="glitchtip-config" field="key.label">B</untrusted>. Pass `key_id`.',
    });
  });

  it('picks by key_id', () => {
    const a = key({ id: 'a', label: 'A' });
    const b = key({ id: 'b', label: 'B' });
    const result = selectKey([a, b], 'acme', 'web', { keyId: 'b' }, ORIGIN);
    expect(result).toMatchObject({ ok: true, key: { id: 'b' } });
  });

  it('refuses an unknown key_id', () => {
    const result = selectKey([key({ id: 'a' })], 'acme', 'web', { keyId: 'nope' }, ORIGIN);
    expect(result).toEqual({
      ok: false,
      message: 'Key nope is not a client key of acme/web.',
    });
  });

  it('picks by dsn matching public + projectID', () => {
    const match = key({ public: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', projectID: 7 });
    const other = key({
      id: 'other',
      public: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      projectID: 7,
    });
    const result = selectKey(
      [match, other],
      'acme',
      'web',
      { dsn: `https://bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb@glitchtip.test/7` },
      ORIGIN,
    );
    expect(result).toMatchObject({ ok: true, key: { id: match.id } });
  });

  it('refuses a dsn matching no key, without naming the dsn', () => {
    const result = selectKey(
      [key({ public: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', projectID: 7 })],
      'acme',
      'web',
      { dsn: 'https://zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz@glitchtip.test/7' },
      ORIGIN,
    );
    expect(result).toEqual({
      ok: false,
      message: 'This DSN is not a key of acme/web on https://glitchtip.test.',
    });
  });

  it('flags a dsn host that differs from the resolved instance, as a diagnostic on success', () => {
    const match = key({ public: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', projectID: 7 });
    const result = selectKey(
      [match],
      'acme',
      'web',
      { dsn: 'https://bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb@other-host.example/7' },
      ORIGIN,
    );
    expect(result).toMatchObject({
      ok: true,
      key: { id: match.id },
      dsnHostMismatch: expect.stringContaining('other-host.example'),
    });
  });

  it('refuses an inactive key', () => {
    const result = selectKey([key({ isActive: false })], 'acme', 'web', {}, ORIGIN);
    expect(result).toEqual({ ok: false, message: `Key ${key().id} is inactive.` });
  });

  it('treats a key with no isActive field as active', () => {
    const result = selectKey([key()], 'acme', 'web', {}, ORIGIN);
    expect(result.ok).toBe(true);
  });

  it('throws (malformed) rather than trust a crafted, non-integer projectID into the request path (should-fix 3)', () => {
    const crafted = key({ projectID: '42/../../admin/users' });
    expect(() => selectKey([crafted], 'acme', 'web', {}, ORIGIN)).toThrow(TypeError);
  });

  it('throws (malformed) on a negative or non-integer projectID', () => {
    expect(() => selectKey([key({ projectID: -1 })], 'acme', 'web', {}, ORIGIN)).toThrow(TypeError);
    expect(() => selectKey([key({ projectID: 1.5 })], 'acme', 'web', {}, ORIGIN)).toThrow(
      TypeError,
    );
  });

  it('throws (malformed) on a public id that is not a uuid (should-fix 3)', () => {
    const crafted = key({ public: 'not-a-uuid' });
    expect(() => selectKey([crafted], 'acme', 'web', {}, ORIGIN)).toThrow(TypeError);
  });
});
