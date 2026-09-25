import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, MockGlitchTip } from '../../test/support/mock-glitchtip';
import { GlitchTipClient, retryAfterSeconds } from './glitchtip.client';
import { GlitchTipError, type Operation } from './glitchtip.errors';
import { ResolvedInstance } from './instance.context';

const BASE = 'https://glitchtip.test';
const TOKEN = 'tok_SECRET_123';
const ORGS = `${BASE}/api/0/organizations/`;
const GET_ORG: Operation = {
  name: 'get organization',
  scopes: ['org:read', 'org:write', 'org:admin'],
  resource: 'Organization',
  id: 'acme',
};

function setup(options: { timeoutMs?: number; token?: string } = {}) {
  const mock = new MockGlitchTip();
  const sleeps: number[] = [];
  const client = new GlitchTipClient(new ResolvedInstance(BASE, options.token ?? TOKEN), {
    timeoutMs: options.timeoutMs ?? 1_000,
    fetch: mock.fetch,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0,
  });
  return { mock, client, sleeps };
}

const listOrgs = (client: GlitchTipClient) =>
  client.page({ name: 'list organizations', scopes: ['org:read'] }, (api) =>
    api.GET('/api/0/organizations/', { params: { query: { limit: 50 } } }),
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

describe('GlitchTipClient', () => {
  afterEach(() => vi.useRealTimers());

  it('sends the bearer token, Accept and User-Agent, and returns the page', async () => {
    const { mock, client } = setup();
    mock.json('GET', ORGS, [{ slug: 'acme' }]);
    const page = await listOrgs(client);
    expect(page).toEqual({ items: [{ slug: 'acme' }], nextCursor: undefined });
    const [request] = mock.requests;
    expect(request.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.headers.get('accept')).toBe('application/json');
    expect(request.headers.get('user-agent')).toMatch(/^smart-glitchtip-mcp\/\d+\.\d+\.\d+/);
    expect(request.url.searchParams.get('limit')).toBe('50');
  });

  it('sends no Authorization header when the instance has no token', async () => {
    const mock = new MockGlitchTip().json('GET', ORGS, []);
    const client = new GlitchTipClient(new ResolvedInstance(BASE, undefined), {
      timeoutMs: 1_000,
      fetch: mock.fetch,
    });
    await listOrgs(client);
    expect(mock.requests[0].headers.has('authorization')).toBe(false);
  });

  it('parses the Link header into nextCursor', async () => {
    const { mock, client } = setup();
    mock.json('GET', ORGS, [], {
      headers: {
        link:
          `<${ORGS}?cursor=p0>; rel="previous"; results="false"; cursor="p0", ` +
          `<${ORGS}?cursor=n1,x>; rel="next"; results="true"; cursor="100:1:0"`,
      },
    });
    expect((await listOrgs(client)).nextCursor).toBe('100:1:0');
  });

  it('retries a GET on 503 twice, then surfaces upstream', async () => {
    const { mock, client, sleeps } = setup();
    mock.json('GET', ORGS, { detail: 'down' }, { status: 503 });
    const error = await failure(listOrgs(client));
    expect(error.kind).toBe('upstream');
    expect(error.message).toBe('GlitchTip returned 503.');
    expect(mock.requests).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('recovers when a retry succeeds', async () => {
    const { mock, client } = setup();
    mock.on('GET', ORGS, jsonResponse({}, 502), jsonResponse([{ slug: 'acme' }]));
    expect((await listOrgs(client)).items).toHaveLength(1);
  });

  it('honours Retry-After before retrying (fake timers)', async () => {
    vi.useFakeTimers();
    const mock = new MockGlitchTip();
    mock.on('GET', ORGS, jsonResponse({}, 429, { 'retry-after': '1' }), jsonResponse([]));
    const client = new GlitchTipClient(new ResolvedInstance(BASE, TOKEN), {
      timeoutMs: 60_000,
      fetch: mock.fetch,
    });
    const pending = listOrgs(client);
    await vi.advanceTimersByTimeAsync(999);
    expect(mock.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(mock.requests).toHaveLength(2);
  });

  it('reports rate limiting with the Retry-After it saw last', async () => {
    const { mock, client } = setup();
    mock.json('GET', ORGS, {}, { status: 429, headers: { 'retry-after': '7' } });
    const error = await failure(listOrgs(client));
    expect(error.kind).toBe('rate_limited');
    expect(error.message).toBe('GlitchTip is rate-limiting; retry after 7s.');
  });

  it('never retries a POST', async () => {
    const { mock, client } = setup();
    mock.json('POST', ORGS, {}, { status: 503 });
    const error = await failure(
      client.call({ name: 'create organization', scopes: [] }, (api) =>
        api.POST('/api/0/organizations/', { body: { name: 'New' } }),
      ),
    );
    expect(error.kind).toBe('upstream');
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].body).toBe('{"name":"New"}');
  });

  it('never retries a DELETE, and returns undefined for 204', async () => {
    const { mock, client } = setup();
    mock.on('DELETE', `${ORGS}acme/`, new Response(null, { status: 204 }));
    const result = await client.call({ name: 'delete organization', scopes: [] }, (api) =>
      api.DELETE('/api/0/organizations/{organization_slug}/', {
        params: { path: { organization_slug: 'acme' } },
      }),
    );
    expect(result).toBeUndefined();
  });

  it('surfaces a timeout as timeout, without retrying', async () => {
    const mock = new MockGlitchTip();
    mock.on(
      'GET',
      ORGS,
      () =>
        new Promise<Response>((_, reject) => {
          setTimeout(() => reject(new DOMException('timed out', 'TimeoutError')), 5);
        }),
    );
    const client = new GlitchTipClient(new ResolvedInstance(BASE, TOKEN), {
      timeoutMs: 20,
      fetch: mock.fetch,
    });
    const error = await failure(listOrgs(client));
    expect(error.kind).toBe('timeout');
    expect(error.message).toBe('GlitchTip did not answer within 20 ms.');
    expect(mock.requests).toHaveLength(1);
  });

  it('aborts a request that exceeds the timeout', async () => {
    const client = new GlitchTipClient(new ResolvedInstance(BASE, TOKEN), {
      timeoutMs: 20,
      fetch: (request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason));
        }),
    });
    expect((await failure(listOrgs(client))).kind).toBe('timeout');
  });

  it('retries a network failure on GET, then reports the instance unreachable', async () => {
    const { mock, client } = setup();
    const error = await failure(listOrgs(client));
    expect(error.kind).toBe('unreachable');
    expect(error.message).toBe('Could not reach https://glitchtip.test.');
    expect(mock.requests).toHaveLength(3);
  });

  it('names the scopes on 403', async () => {
    const { mock, client } = setup();
    mock.json('GET', `${ORGS}acme/`, { detail: 'nope' }, { status: 403 });
    const error = await failure(
      client.call(GET_ORG, (api) =>
        api.GET('/api/0/organizations/{organization_slug}/', {
          params: { path: { organization_slug: 'acme' } },
        }),
      ),
    );
    expect(error.kind).toBe('forbidden');
    expect(error.message).toBe(
      'The token lacks permission for get organization. It needs one of: org:read, org:write, org:admin.',
    );
  });

  it('states a plain requirement on 403 for routes GlitchTip does not gate by scope', async () => {
    const { mock, client } = setup();
    mock.json('GET', `${BASE}/api/0/`, {}, { status: 403 });
    const error = await failure(
      client.call(
        { name: 'read the API root', scopes: [], requirement: 'any valid token' },
        (api) => api.GET('/api/0/'),
      ),
    );
    expect(error.message).toBe(
      'The token lacks permission for read the API root. It needs any valid token.',
    );
    expect(error.message).not.toContain('unknown');
  });

  it('never asks fetch to follow a redirect, and surfaces the 3xx instead', async () => {
    const { mock, client } = setup();
    mock.on(
      'GET',
      `${ORGS}acme/`,
      new Response(null, { status: 301, headers: { location: 'https://evil.test/steal' } }),
    );
    const error = await failure(
      client.call(GET_ORG, (api) =>
        api.GET('/api/0/organizations/{organization_slug}/', {
          params: { path: { organization_slug: 'acme' } },
        }),
      ),
    );
    expect(mock.requests.map((r) => r.redirect)).toEqual(['manual']);
    expect(mock.followingRedirects).toEqual([]);
    expect(mock.requests.map((r) => r.url.host)).toEqual(['glitchtip.test']);
    expect(error.message).toContain('redirect (301)');
  });

  it.each([
    [400, 'invalid', 'GlitchTip rejected the request: bad name'],
    [422, 'invalid', 'GlitchTip rejected the request: bad name'],
    [401, 'unauthenticated', 'The GlitchTip token was rejected (401). Check the token.'],
    [404, 'not_found', 'Organization acme was not found.'],
    [302, 'upstream', expect.stringContaining('redirect (302)')],
  ])('maps %i to %s', async (status, kind, message) => {
    const { mock, client } = setup();
    mock.json('GET', `${ORGS}acme/`, { detail: 'bad name' }, { status });
    const error = await failure(
      client.call(GET_ORG, (api) =>
        api.GET('/api/0/organizations/{organization_slug}/', {
          params: { path: { organization_slug: 'acme' } },
        }),
      ),
    );
    expect(error.kind).toBe(kind);
    expect(error.message).toEqual(message);
  });

  it('bounds the detail to 500 characters', async () => {
    const { mock, client } = setup();
    mock.json('POST', ORGS, { detail: 'x'.repeat(2_000) }, { status: 400 });
    const error = await failure(
      client.call({ name: 'create organization', scopes: [] }, (api) =>
        api.POST('/api/0/organizations/', { body: { name: 'n' } }),
      ),
    );
    expect(error.detail).toHaveLength(501);
  });

  it('reports a non-JSON success body as upstream', async () => {
    const { mock, client } = setup();
    mock.on('GET', ORGS, new Response('<html>login</html>', { status: 200 }));
    expect((await failure(listOrgs(client))).kind).toBe('upstream');
  });

  it('removes the token if GlitchTip echoes it back', async () => {
    const { mock, client } = setup();
    mock.json('POST', ORGS, { detail: `token ${TOKEN} is malformed` }, { status: 400 });
    const error = await failure(
      client.call({ name: 'create organization', scopes: [] }, (api) =>
        api.POST('/api/0/organizations/', { body: { name: 'n' } }),
      ),
    );
    expect(error.message).not.toContain(TOKEN);
    expect(error.detail).not.toContain(TOKEN);
  });
});

describe('retryAfterSeconds', () => {
  it('reads seconds and HTTP dates, capped at 10', () => {
    const now = Date.parse('2026-09-25T12:00:00Z');
    expect(retryAfterSeconds('3', now)).toBe(3);
    expect(retryAfterSeconds('120', now)).toBe(10);
    expect(retryAfterSeconds('Fri, 25 Sep 2026 12:00:04 GMT', now)).toBe(4);
    expect(retryAfterSeconds('soon', now)).toBeUndefined();
    expect(retryAfterSeconds(null, now)).toBeUndefined();
  });
});
