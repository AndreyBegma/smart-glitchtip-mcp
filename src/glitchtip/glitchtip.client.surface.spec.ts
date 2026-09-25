import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MockGlitchTip } from '../../test/support/mock-glitchtip';
import { type FetchLike, GlitchTipClient } from './glitchtip.client';
import { GlitchTipError, type Operation } from './glitchtip.errors';
import { ResolvedInstance } from './instance.context';

// BUG-20260925-006: the client surface phase 2 builds on — malformed lists,
// response headers, the raw call, per-call timeouts, multipart bodies and the
// path-segment guard (acceptance 5, 10, 11, 14).

const BASE = 'https://glitchtip.test';
const TOKEN = 'tok_SECRET_123';
const API = `${BASE}/api/0`;
const ORGS = `${API}/organizations/`;
const OP: Operation = { name: 'test call', scopes: [] };

function setup(options: { base?: string; timeoutMs?: number; fetch?: FetchLike } = {}) {
  const mock = new MockGlitchTip();
  const client = new GlitchTipClient(new ResolvedInstance(options.base ?? BASE, TOKEN), {
    timeoutMs: options.timeoutMs ?? 1_000,
    fetch: options.fetch ?? mock.fetch,
    sleep: async () => undefined,
    random: () => 0,
  });
  return { mock, client };
}

const listOrgs = (client: GlitchTipClient, options?: { timeoutMs?: number }) =>
  client.page(
    { name: 'list organizations', scopes: ['org:read'] },
    (api) => api.GET('/api/0/organizations/'),
    options,
  );

async function failure(promise: Promise<unknown>): Promise<GlitchTipError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GlitchTipError) return error;
    throw error;
  }
  throw new Error('expected a GlitchTipError');
}

/** A fetch that answers after `delayMs`, honouring the request's abort signal as fetch does. */
function slowFetch(delayMs: number): FetchLike {
  return (request) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response('[]', { status: 200 })), delayMs);
      request.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(request.signal.reason);
      });
    });
}

describe('page()', () => {
  it('raises malformed when a list endpoint answers with an object (acceptance 5)', async () => {
    const { mock, client } = setup();
    mock.json('GET', ORGS, {});
    const error = await failure(listOrgs(client));
    expect(error.kind).toBe('malformed');
    expect(error.message).toContain('list organizations');
  });

  it('returns the response headers, so X-Hits is readable (acceptance 10)', async () => {
    const { mock, client } = setup();
    mock.json('GET', ORGS, [], { headers: { 'x-hits': '1234' } });
    expect((await listOrgs(client)).headers.get('x-hits')).toBe('1234');
  });

  it('scrubs the token from the response headers it returns', async () => {
    const { mock, client } = setup();
    mock.json('GET', ORGS, [], { headers: { 'x-debug': `auth=Bearer ${TOKEN}`, 'x-hits': '2' } });
    const { headers } = await listOrgs(client);
    expect(headers.get('x-debug')).toBe('auth=Bearer [redacted]');
    for (const [, value] of headers) expect(value).not.toContain(TOKEN);
  });

  it('reports a 204 or an empty 200 on a list as malformed, not as an empty page', async () => {
    const { mock, client } = setup();
    mock.on('GET', ORGS, new Response(null, { status: 204 }), new Response('', { status: 200 }));
    expect((await failure(listOrgs(client))).kind).toBe('malformed');
    expect((await failure(listOrgs(client))).kind).toBe('malformed');
  });
});

describe('raw()', () => {
  it('returns a 404 as a status and text, without throwing', async () => {
    const { mock, client } = setup();
    mock.json('GET', `${API}/unknown/`, { detail: 'Not found.' }, { status: 404 });
    const response = await client.raw(OP, 'GET', '/api/0/unknown/');
    expect(response.status).toBe(404);
    expect(JSON.parse(response.text)).toEqual({ detail: 'Not found.' });
  });

  it('sends the bearer, the query and caller headers, and scrubs the token from the body', async () => {
    const { mock, client } = setup();
    mock.json('GET', `${API}/echo/`, { seen: `Bearer ${TOKEN}` });
    const response = await client.raw(OP, 'get', 'api/0/echo/', {
      query: { a: 1, b: undefined, c: 'x y' },
      headers: { 'x-extra': 'yes' },
    });
    expect(response.text).not.toContain(TOKEN);
    expect(response.text).toContain('[redacted]');
    const [request] = mock.requests;
    expect(request.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.headers.get('x-extra')).toBe('yes');
    expect(request.url.search).toBe('?a=1&c=x+y');
  });

  it.each([
    ['another origin', '//evil.test/api/0/'],
    ['outside /api/', '/admin/'],
    ['/api/ escaped with ..', '/api/../admin/'],
    ['the bare /api', '/api'],
  ])('refuses a path that resolves to %s, with no request', async (_, path) => {
    const { mock, client } = setup();
    const error = await failure(client.raw(OP, 'GET', path));
    expect(error.kind).toBe('invalid');
    expect(error.message).toMatch(/^Refused test call: the path must stay under/);
    expect(mock.requests).toEqual([]);
  });

  it.each([
    '/api/%2e%2e/admin/',
    '/api/0/%2E/x/',
    '/api/0/a%2fb/',
    '/api/0/a%2Fb/',
    '/api/0/a%5cb/',
    '/api/0/a%5Cb/',
  ])('refuses an encoded separator or dot in %s, with no request', async (path) => {
    const { mock, client } = setup();
    const error = await failure(client.raw(OP, 'GET', path));
    expect(error.kind).toBe('invalid');
    expect(error.message).toMatch(/may not contain an encoded/);
    expect(mock.requests).toEqual([]);
  });

  it.each(['TRACE', 'CONNECT', 'OPTIONS', 'FOO', 'GET\r\nX'])(
    'refuses the method %j as invalid, with no request',
    async (method) => {
      const { mock, client } = setup();
      const error = await failure(client.raw(OP, method, '/api/0/'));
      expect(error.kind).toBe('invalid');
      expect(error.message).toMatch(/^The method must be one of/);
      expect(mock.requests).toEqual([]);
    },
  );

  it.each(['GET', 'head'])(
    'refuses a body on %s as invalid, never as malformed',
    async (method) => {
      const { mock, client } = setup();
      const error = await failure(client.raw(OP, method, '/api/0/', { body: { a: 1 } }));
      expect(error.kind).toBe('invalid');
      expect(error.message).toMatch(/cannot carry a body/);
      expect(mock.requests).toEqual([]);
    },
  );

  it('refuses an invalid header value and a body that is not JSON as invalid', async () => {
    const { mock, client } = setup();
    const header = await failure(
      client.raw(OP, 'POST', '/api/0/', { headers: { 'x-a': 'bad\r\nvalue' } }),
    );
    expect(header.kind).toBe('invalid');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const body = await failure(client.raw(OP, 'POST', '/api/0/', { body: cyclic }));
    expect(body.kind).toBe('invalid');
    expect(mock.requests).toEqual([]);
  });

  it('scrubs the token from every response header (Location, echoes)', async () => {
    const { mock, client } = setup();
    mock.on(
      'GET',
      `${API}/moved/`,
      new Response(null, {
        status: 302,
        headers: { location: `${BASE}/login?token=${TOKEN}`, 'x-echo': `Bearer ${TOKEN}` },
      }),
    );
    const response = await client.raw(OP, 'GET', '/api/0/moved/');
    for (const [, value] of response.headers) expect(value).not.toContain(TOKEN);
    expect(response.headers.get('location')).toBe(`${BASE}/login?token=[redacted]`);
    expect(response.headers.get('x-echo')).toBe('Bearer [redacted]');
  });

  it('keeps an instance path prefix', async () => {
    const { mock, client } = setup({ base: `${BASE}/glitchtip` });
    mock.json('GET', `${BASE}/glitchtip/api/0/x/`, []);
    expect((await client.raw(OP, 'GET', '/api/0/x/')).status).toBe(200);
    expect((await failure(client.raw(OP, 'GET', '/api/../../api/0/x/'))).kind).toBe('invalid');
  });

  it.each([
    'Authorization',
    'Proxy-Authorization',
    'host',
    'COOKIE',
    'Forwarded',
    'X-Forwarded-For',
    'x-forwarded-host',
    'X-Real-IP',
  ])('refuses a caller %s header', async (name) => {
    const { mock, client } = setup();
    const error = await failure(client.raw(OP, 'GET', '/api/0/', { headers: { [name]: 'x' } }));
    expect(error.kind).toBe('invalid');
    expect(mock.requests).toEqual([]);
  });

  it('never follows a redirect', async () => {
    const { mock, client } = setup();
    mock.on(
      'GET',
      `${API}/moved/`,
      new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }),
    );
    const response = await client.raw(OP, 'GET', '/api/0/moved/');
    expect(response.status).toBe(302);
    expect(mock.requests).toHaveLength(1);
    expect(mock.followingRedirects).toEqual([]);
  });

  it('retries a GET 503 but not a POST 503 (D-13)', async () => {
    const unavailable = () => new Response('down', { status: 503 });
    const get = setup();
    get.mock.on('GET', `${API}/x/`, unavailable);
    expect((await get.client.raw(OP, 'GET', '/api/0/x/')).status).toBe(503);
    expect(get.mock.requests).toHaveLength(3);

    const post = setup();
    post.mock.on('POST', `${API}/x/`, unavailable);
    expect((await post.client.raw(OP, 'POST', '/api/0/x/', { body: { a: 1 } })).status).toBe(503);
    expect(post.mock.requests).toHaveLength(1);
    expect(post.mock.requests[0].headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(post.mock.requests[0].body)).toEqual({ a: 1 });
  });

  it('turns a transport failure into unreachable', async () => {
    const { client } = setup();
    expect((await failure(client.raw(OP, 'POST', '/api/0/nowhere/'))).kind).toBe('unreachable');
  });
});

describe('per-call timeout', () => {
  it('a timeoutMs of 200 times out a 500 ms answer while the configured timeout is 15 s', async () => {
    const { client } = setup({ timeoutMs: 15_000, fetch: slowFetch(500) });
    const typed = await failure(listOrgs(client, { timeoutMs: 200 }));
    expect(typed.kind).toBe('timeout');
    expect(typed.message).toContain('200 ms');
    const raw = await failure(client.raw(OP, 'GET', '/api/0/organizations/', { timeoutMs: 200 }));
    expect(raw.kind).toBe('timeout');
  });

  it('the configured timeout still applies without an override', async () => {
    const { client } = setup({ timeoutMs: 15_000, fetch: slowFetch(50) });
    expect((await listOrgs(client)).items).toEqual([]);
  });

  it.each([99, 600_001, 1.5])('refuses an override of %s as a defect', async (timeoutMs) => {
    const { client } = setup();
    await expect(listOrgs(client, { timeoutMs })).rejects.not.toBeInstanceOf(GlitchTipError);
  });
});

describe('multipart and binary bodies', () => {
  it('a FormData POST arrives as multipart/form-data with the part intact (typed and raw)', async () => {
    const { mock, client } = setup();
    mock.json('POST', ORGS, {});
    const form = () => {
      const data = new FormData();
      data.append('file', new Blob(['hello part']), 'a.txt');
      return data;
    };
    await client.call(OP, (api) => api.POST('/api/0/organizations/', { body: form() as never }));
    await client.raw(OP, 'POST', '/api/0/organizations/', { body: form() });
    for (const request of mock.requests) {
      expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
      expect(request.body).toContain('filename="a.txt"');
      expect(request.body).toContain('hello part');
    }
  });

  it('records bodyBytes, so a gzip body round-trips (acceptance 14)', async () => {
    const { mock, client } = setup();
    mock.json('POST', `${API}/chunk/`, {});
    const gz = gzipSync(Buffer.from('chunk content'));
    await client.raw(OP, 'POST', '/api/0/chunk/', {
      body: new Uint8Array(gz),
      headers: { 'content-encoding': 'gzip' },
    });
    expect(gunzipSync(mock.requests[0].bodyBytes).toString()).toBe('chunk content');
  });
});

describe('path-segment guard (acceptance 11)', () => {
  it.each(['..', '.'])(
    'refuses a typed call whose path parameter is %s, with no request',
    async (slug) => {
      const { mock, client } = setup();
      const error = await failure(
        client.call(OP, (api) =>
          api.GET('/api/0/organizations/{organization_slug}/', {
            params: { path: { organization_slug: slug } },
          }),
        ),
      );
      expect(error.kind).toBe('invalid');
      expect(error.message).toBe('A path parameter is not a single path segment.');
      expect(mock.requests).toEqual([]);
    },
  );

  it('lets an encoded slash through as one segment', async () => {
    const { mock, client } = setup();
    mock.json('GET', `${API}/organizations/a%2Fb/`, { slug: 'a/b' });
    await client.call(OP, (api) =>
      api.GET('/api/0/organizations/{organization_slug}/', {
        params: { path: { organization_slug: 'a/b' } },
      }),
    );
    expect(mock.requests[0].url.pathname).toBe('/api/0/organizations/a%2Fb/');
  });

  it('holds below an instance path prefix', async () => {
    const { mock, client } = setup({ base: `${BASE}/glitchtip` });
    mock.json('GET', `${BASE}/glitchtip/api/0/organizations/acme/`, { slug: 'acme' });
    await client.call(OP, (api) =>
      api.GET('/api/0/organizations/{organization_slug}/', {
        params: { path: { organization_slug: 'acme' } },
      }),
    );
    expect(mock.requests).toHaveLength(1);
  });
});
