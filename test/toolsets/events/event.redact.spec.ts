import { describe, expect, it } from 'vitest';
import { applyJsonPointer, InvalidPointerError } from '../../../src/toolsets/events/event.pointer';
import { redactEventPayload } from '../../../src/toolsets/events/event.redact';

// Acceptance 5, 6: user IP/geo, cookies and secret headers never survive
// redaction, in either header shape; an invalid pointer is a validation error.

describe('redactEventPayload (acceptance 5)', () => {
  it('removes user.ip_address and user.geo', () => {
    const redacted = redactEventPayload({
      user: { id: '1', email: 'a@b.test', ip_address: '203.0.113.9', geo: { city: 'X' } },
    }) as { user: Record<string, unknown> };
    expect(redacted.user.ip_address).toBeUndefined();
    expect(redacted.user.geo).toBeUndefined();
    expect(redacted.user.email).toBe('a@b.test');
  });

  it('redacts cookies and secret headers given as [key, value] pairs', () => {
    const redacted = redactEventPayload({
      request: {
        cookies: 'session=secret',
        headers: [
          ['Cookie', 'session=secret'],
          ['authorization', 'Bearer x'],
          ['User-Agent', 'test'],
        ],
      },
    }) as { request: { cookies: unknown; headers: unknown[][] } };
    expect(redacted.request.cookies).toBe('[redacted]');
    expect(redacted.request.headers).toEqual([
      ['Cookie', '[redacted]'],
      ['authorization', '[redacted]'],
      ['User-Agent', 'test'],
    ]);
  });

  it('redacts secret headers given as an object', () => {
    const redacted = redactEventPayload({
      request: { headers: { Cookie: 'session=secret', 'X-Trace': 'abc' } },
    }) as { request: { headers: Record<string, unknown> } };
    expect(redacted.request.headers.Cookie).toBe('[redacted]');
    expect(redacted.request.headers['X-Trace']).toBe('abc');
  });

  it('does not mutate the input', () => {
    const raw = { user: { ip_address: '203.0.113.9' } };
    redactEventPayload(raw);
    expect(raw.user.ip_address).toBe('203.0.113.9');
  });
});

describe('applyJsonPointer (acceptance 6)', () => {
  const doc = { contexts: { runtime: { name: 'Node', version: '24' } }, list: ['a', 'b'] };

  it('returns the whole document for the empty pointer', () => {
    expect(applyJsonPointer(doc, '')).toBe(doc);
  });

  it('resolves a nested object path', () => {
    expect(applyJsonPointer(doc, '/contexts/runtime')).toEqual({ name: 'Node', version: '24' });
  });

  it('resolves an array index', () => {
    expect(applyJsonPointer(doc, '/list/1')).toBe('b');
  });

  it('throws naming the first missing segment', () => {
    expect(() => applyJsonPointer(doc, '/contexts/nope/deeper')).toThrow(InvalidPointerError);
    try {
      applyJsonPointer(doc, '/contexts/nope/deeper');
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPointerError);
      expect((error as Error).message).toContain('contexts/nope');
    }
  });

  it('rejects a pointer that does not start with "/"', () => {
    expect(() => applyJsonPointer(doc, 'contexts')).toThrow(InvalidPointerError);
  });
});
