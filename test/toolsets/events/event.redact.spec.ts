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

describe('redactEventPayload — IP-revealing headers/env (review 1)', () => {
  it('redacts proxy headers that carry the caller IP, any case, either header shape', () => {
    const redacted = redactEventPayload({
      request: {
        headers: [
          ['X-Forwarded-For', '203.0.113.9'],
          ['x-real-ip', '203.0.113.9'],
          ['Forwarded', 'for=203.0.113.9'],
          ['CF-Connecting-IP', '203.0.113.9'],
          ['True-Client-IP', '203.0.113.9'],
          ['User-Agent', 'kept'],
        ],
      },
    }) as { request: { headers: [string, string][] } };
    for (const [name, value] of redacted.request.headers) {
      if (name === 'User-Agent') expect(value).toBe('kept');
      else expect(value).toBe('[redacted]');
    }
  });

  it('redacts the same headers when given as an object', () => {
    const redacted = redactEventPayload({
      request: { headers: { 'X-Forwarded-For': '203.0.113.9', Accept: 'application/json' } },
    }) as { request: { headers: Record<string, unknown> } };
    expect(redacted.request.headers['X-Forwarded-For']).toBe('[redacted]');
    expect(redacted.request.headers.Accept).toBe('application/json');
  });

  it('deletes request.env.REMOTE_ADDR', () => {
    const redacted = redactEventPayload({
      request: { env: { REMOTE_ADDR: '203.0.113.9', SERVER_NAME: 'kept' } },
    }) as { request: { env: Record<string, unknown> } };
    expect(redacted.request.env.REMOTE_ADDR).toBeUndefined();
    expect(redacted.request.env.SERVER_NAME).toBe('kept');
  });
});

describe('redactEventPayload — extended secret-header pattern (review 2)', () => {
  it.each(['set-cookie', 'Proxy-Authorization', 'X-Api-Key', 'x-auth-token', 'X-Session-Secret'])(
    'redacts %s',
    (name) => {
      const redacted = redactEventPayload({
        request: { headers: [[name, 'sensitive-value']] },
      }) as { request: { headers: [string, string][] } };
      expect(redacted.request.headers[0][1]).toBe('[redacted]');
    },
  );
});

describe('redactEventPayload — legacy shapes (review 3, nit)', () => {
  it('redacts sentry.interfaces.User the same as user', () => {
    const redacted = redactEventPayload({
      'sentry.interfaces.User': { ip_address: '203.0.113.9', email: 'kept@example.com' },
    }) as { 'sentry.interfaces.User': Record<string, unknown> };
    expect(redacted['sentry.interfaces.User'].ip_address).toBeUndefined();
    expect(redacted['sentry.interfaces.User'].email).toBe('kept@example.com');
  });

  it('redacts sentry.interfaces.Http the same as request', () => {
    const redacted = redactEventPayload({
      'sentry.interfaces.Http': { cookies: 'secret', headers: [['Cookie', 'secret']] },
    }) as { 'sentry.interfaces.Http': { cookies: unknown; headers: [string, string][] } };
    expect(redacted['sentry.interfaces.Http'].cookies).toBe('[redacted]');
    expect(redacted['sentry.interfaces.Http'].headers[0][1]).toBe('[redacted]');
  });

  it('redacts entries[type=request].data.headers/env the same way', () => {
    const redacted = redactEventPayload({
      entries: [
        {
          type: 'request',
          data: { headers: [['Authorization', 'Bearer x']], env: { REMOTE_ADDR: '203.0.113.9' } },
        },
      ],
    }) as { entries: { data: { headers: [string, string][]; env: Record<string, unknown> } }[] };
    expect(redacted.entries[0].data.headers[0][1]).toBe('[redacted]');
    expect(redacted.entries[0].data.env.REMOTE_ADDR).toBeUndefined();
  });

  it('removes contexts.*.client_ip', () => {
    const redacted = redactEventPayload({
      contexts: { runtime: { name: 'Node', client_ip: '203.0.113.9' }, os: { name: 'Linux' } },
    }) as { contexts: { runtime: Record<string, unknown>; os: Record<string, unknown> } };
    expect(redacted.contexts.runtime.client_ip).toBeUndefined();
    expect(redacted.contexts.runtime.name).toBe('Node');
    expect(redacted.contexts.os.client_ip).toBeUndefined();
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

  it('does not resolve through the prototype chain (review 4)', () => {
    // `"constructor" in {}` is true (it's inherited); Object.hasOwn must be
    // what decides, or this returns the Object constructor instead of
    // refusing the pointer.
    expect(() => applyJsonPointer(doc, '/constructor')).toThrow(InvalidPointerError);
    expect(() => applyJsonPointer(doc, '/contexts/constructor')).toThrow(InvalidPointerError);
    expect(() => applyJsonPointer(doc, '/toString')).toThrow(InvalidPointerError);
  });
});
