import { afterEach, describe, expect, it } from 'vitest';
import { type BootedHttp, bootHttp } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// FEAT-20260925-019, acceptance 10: resources/read over real HTTP resolves
// the instance exactly as tools/call does (D-03, D-05, D-11): the guard runs
// first, a pass-through bearer reaches GlitchTip, X-GlitchTip-Org is the
// default organization, and X-GlitchTip-Url is allowlist-checked.

const ENV_URL = 'https://env.test';
const OTHER_URL = 'https://other.test';
const SERVER_SECRET = 'server-secret-value';
const ENV_TOKEN = 'tok_ENV_value';
const CLIENT_TOKEN = 'tok_CLIENT_value';

const ENV = {
  MCP_AUTH_TOKEN: SERVER_SECRET,
  GLITCHTIP_URL: ENV_URL,
  GLITCHTIP_TOKEN: ENV_TOKEN,
  GLITCHTIP_ALLOWED_URLS: OTHER_URL,
  GLITCHTIP_DEFAULT_ORG: 'env-org',
  GLITCHTIP_TOOLSETS: 'issues,events',
};

const ISSUE = {
  id: '42',
  shortId: 'PROJ-42',
  title: 'TypeError: x is not a function',
  culprit: 'app.views.handler',
  count: '7',
  userCount: 3,
  numComments: 0,
  type: 'error',
  level: 'error',
  status: 'unresolved',
  metadata: {},
  project: { id: '1', slug: 'web', name: 'Web' },
  firstSeen: '2026-01-01T00:00:00Z',
  lastSeen: '2026-01-02T00:00:00Z',
  assignedTo: null,
  stats: { '24h': [] },
  permalink: 'Not implemented',
};

function issueUrl(origin: string, org: string): string {
  return `${origin}/api/0/organizations/${org}/issues/42/`;
}

let server: BootedHttp | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('resources/read over HTTP (acceptance 10)', () => {
  it('answers 401 without credentials, calling nothing', async () => {
    const mock = new MockGlitchTip();
    server = await bootHttp(ENV, mock);
    const response = await fetch(server.mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri: 'glitchtip://issues/42' },
      }),
    });
    expect(response.status).toBe(401);
    expect(mock.requests).toEqual([]);
  });

  it('forwards a pass-through bearer to GlitchTip', async () => {
    const mock = new MockGlitchTip().json('GET', issueUrl(ENV_URL, 'env-org'), ISSUE);
    server = await bootHttp(ENV, mock);
    const client = await server.connect({ authorization: `Bearer ${CLIENT_TOKEN}` });
    await client.readResource({ uri: 'glitchtip://issues/42' });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].headers.get('authorization')).toBe(`Bearer ${CLIENT_TOKEN}`);
  });

  it('uses X-GlitchTip-Org when the URI names no organization', async () => {
    const mock = new MockGlitchTip().json('GET', issueUrl(ENV_URL, 'acme'), ISSUE);
    server = await bootHttp(ENV, mock);
    const client = await server.connect({
      authorization: `Bearer ${SERVER_SECRET}`,
      'x-glitchtip-org': 'acme',
    });
    const { contents } = await client.readResource({ uri: 'glitchtip://issues/42' });
    expect(mock.requests.map((r) => r.url.href)).toEqual([issueUrl(ENV_URL, 'acme')]);
    const [item] = contents;
    // The header organization is never written into the Latest event line.
    expect('text' in item && item.text.split('\n').at(-1)).toBe(
      'Latest event: glitchtip://issues/42/events/latest',
    );
  });

  it('refuses an X-GlitchTip-Url outside the allowlist with -32603, calling nothing', async () => {
    const mock = new MockGlitchTip();
    server = await bootHttp(ENV, mock);
    const client = await server.connect({
      authorization: `Bearer ${CLIENT_TOKEN}`,
      'x-glitchtip-url': 'http://169.254.169.254/latest',
    });
    await expect(client.readResource({ uri: 'glitchtip://issues/42' })).rejects.toMatchObject({
      code: -32603,
      message: expect.stringContaining('instance URL not allowed: http://169.254.169.254/latest'),
    });
    expect(mock.requests).toEqual([]);
    expect(mock.unrouted).toEqual([]);
  });

  it('never logs the server secret or either token', async () => {
    const mock = new MockGlitchTip().json('GET', issueUrl(ENV_URL, 'env-org'), ISSUE);
    server = await bootHttp(ENV, mock);
    const client = await server.connect({ authorization: `Bearer ${CLIENT_TOKEN}` });
    await client.readResource({ uri: 'glitchtip://issues/42' });
    for (const secret of [SERVER_SECRET, ENV_TOKEN, CLIENT_TOKEN]) {
      expect(server.logs()).not.toContain(secret);
    }
  });
});
