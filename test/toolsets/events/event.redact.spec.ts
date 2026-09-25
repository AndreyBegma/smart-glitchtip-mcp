import { describe, expect, it } from 'vitest';
import { applyJsonPointer, InvalidPointerError } from '../../../src/toolsets/events/event.pointer';
import {
  redactEventPayload,
  redactQueryString,
  redactUrl,
} from '../../../src/toolsets/events/event.redact';

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

describe('redactQueryString / redactUrl (review 3)', () => {
  it('redacts secret-named query parameter values, keeping the rest', () => {
    expect(redactQueryString('q=hello&token=abc123&page=2')).toBe(
      'q=hello&token=[redacted]&page=2',
    );
  });

  it('matches secret names case-insensitively and by pattern (password, api_key, …)', () => {
    expect(redactQueryString('Password=hunter2&X-Api-Key=xyz')).toBe(
      'Password=[redacted]&X-Api-Key=[redacted]',
    );
  });

  it('leaves a query string with no secret-named parameter untouched', () => {
    expect(redactQueryString('q=hello&page=2')).toBe('q=hello&page=2');
  });

  it('redacts a secret-named query parameter embedded in a URL, keeping the rest of the URL', () => {
    const url = 'https://example.com/api/login?user=alice&token=abc123#section';
    expect(redactUrl(url)).toBe(
      'https://example.com/api/login?user=alice&token=[redacted]#section',
    );
  });

  it('leaves a URL with no query string untouched', () => {
    expect(redactUrl('https://example.com/path')).toBe('https://example.com/path');
  });
});

describe('redactEventPayload — request.data, query/url params, ip tags (review 3)', () => {
  it('redacts secret-named fields inside request.data (a record)', () => {
    const redacted = redactEventPayload({
      request: { data: { username: 'alice', password: 'hunter2', csrf_token: 'xyz' } },
    }) as { request: { data: Record<string, unknown> } };
    expect(redacted.request.data.username).toBe('alice');
    expect(redacted.request.data.password).toBe('[redacted]');
    expect(redacted.request.data.csrf_token).toBe('[redacted]');
  });

  it('redacts secret-named fields inside request.data (a form-encoded string)', () => {
    const redacted = redactEventPayload({
      request: { data: 'username=alice&password=hunter2' },
    }) as { request: { data: string } };
    expect(redacted.request.data).toBe('username=alice&password=[redacted]');
  });

  it('redacts secret-named query parameters, as pairs, an object, or a string', () => {
    const asPairs = redactEventPayload({
      request: {
        query: [
          ['q', '1'],
          ['api_key', 'secret-value'],
        ],
      },
    }) as { request: { query: [string, string][] } };
    expect(asPairs.request.query).toEqual([
      ['q', '1'],
      ['api_key', '[redacted]'],
    ]);

    const asObject = redactEventPayload({
      request: { query: { q: '1', token: 'secret-value' } },
    }) as { request: { query: Record<string, unknown> } };
    expect(asObject.request.query.token).toBe('[redacted]');

    const asString = redactEventPayload({
      request: { query: 'q=1&token=secret-value' },
    }) as { request: { query: string } };
    expect(asString.request.query).toBe('q=1&token=[redacted]');
  });

  it('redacts a secret-named query parameter in request.url', () => {
    const redacted = redactEventPayload({
      request: { url: 'https://example.com/login?token=secret-value' },
    }) as { request: { url: string } };
    expect(redacted.request.url).toBe('https://example.com/login?token=[redacted]');
  });

  it('drops a tag whose key is user.ip, ip or client_ip (array shape)', () => {
    const redacted = redactEventPayload({
      tags: [
        { key: 'user.ip', value: '203.0.113.9' },
        { key: 'ip', value: '203.0.113.9' },
        { key: 'client_ip', value: '203.0.113.9' },
        { key: 'release', value: '1.0' },
      ],
    }) as { tags: { key: string; value: string }[] };
    expect(redacted.tags).toEqual([{ key: 'release', value: '1.0' }]);
  });

  it('drops an ip-named tag key when tags is an object map', () => {
    const redacted = redactEventPayload({
      tags: { ip: '203.0.113.9', release: '1.0' },
    }) as { tags: Record<string, unknown> };
    expect(redacted.tags.ip).toBeUndefined();
    expect(redacted.tags.release).toBe('1.0');
  });
});
