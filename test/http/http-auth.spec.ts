import { afterEach, describe, expect, it } from 'vitest';
import { type BootedHttp, bootHttp, resultText } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// Acceptance 5 and 6 over real HTTP on an ephemeral port. Review gate "ssrf":
// a header URL outside the allowlist is refused (AGENTS.md rule 9).

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
  GLITCHTIP_TOOLSETS: 'organizations',
};

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 't', version: '1' },
  },
};

function mockBoth(): MockGlitchTip {
  return new MockGlitchTip()
    .json('GET', `${ENV_URL}/api/0/organizations/`, [
      { slug: 'env-org', name: 'Env', dateCreated: '2026-01-01' },
    ])
    .json('GET', `${OTHER_URL}/api/0/organizations/`, [
      { slug: 'other-org', name: 'Other', dateCreated: '2026-01-01' },
    ]);
}

let server: BootedHttp | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('HTTP authentication (acceptance 5)', () => {
  it('answers 401 with WWW-Authenticate: Bearer before any JSON-RPC', async () => {
    server = await bootHttp(ENV, mockBoth());
    for (const body of [INITIALIZE, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]) {
      const response = await fetch(server.mcpUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
    }
  });

  it('serves the env instance with the env token for MCP_AUTH_TOKEN', async () => {
    const mock = mockBoth();
    server = await bootHttp(ENV, mock);
    const client = await server.connect({ authorization: `Bearer ${SERVER_SECRET}` });
    const result = await client.callTool({ name: 'list_organizations', arguments: {} });
    expect(resultText(result)).toContain('env-org');
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].url.origin).toBe(ENV_URL);
    expect(mock.requests[0].headers.get('authorization')).toBe(`Bearer ${ENV_TOKEN}`);
  });

  it('forwards any other bearer to GlitchTip unchanged', async () => {
    const mock = mockBoth();
    server = await bootHttp(ENV, mock);
    const client = await server.connect({ authorization: `Bearer ${CLIENT_TOKEN}` });
    await client.callTool({ name: 'list_organizations', arguments: {} });
    expect(mock.requests[0].url.origin).toBe(ENV_URL);
    expect(mock.requests[0].headers.get('authorization')).toBe(`Bearer ${CLIENT_TOKEN}`);
  });

  it('honours MCP_HTTP_PATH and keeps /healthz open', async () => {
    server = await bootHttp({ ...ENV, MCP_HTTP_PATH: '/custom/mcp' }, mockBoth());
    expect(server.mcpUrl.pathname).toBe('/custom/mcp');
    const client = await server.connect({ authorization: `Bearer ${SERVER_SECRET}` });
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    const health = await fetch(new URL('/healthz', server.baseUrl));
    expect(health.status).toBe(200);
    expect(await health.text()).toBe('ok');
  });

  it('does not log the Authorization header', async () => {
    server = await bootHttp(ENV, mockBoth());
    const client = await server.connect({ authorization: `Bearer ${CLIENT_TOKEN}` });
    await client.callTool({ name: 'list_organizations', arguments: {} });
    expect(server.logs()).toContain('request completed');
    expect(server.logs()).not.toContain(CLIENT_TOKEN);
    expect(server.logs()).not.toContain(SERVER_SECRET);
  });
});

describe('instance URL header (acceptance 6, ssrf gate)', () => {
  it('refuses a URL outside the allowlist, calling nothing', async () => {
    const mock = mockBoth();
    server = await bootHttp(ENV, mock);
    const client = await server.connect({
      authorization: `Bearer ${CLIENT_TOKEN}`,
      'x-glitchtip-url': 'http://169.254.169.254/latest',
    });
    const result = await client.callTool({ name: 'list_organizations', arguments: {} });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(
      /^instance URL not allowed: http:\/\/169\.254\.169\.254\/latest/,
    );
    expect(mock.requests).toHaveLength(0);
    expect(mock.unrouted).toHaveLength(0);
  });

  it('calls the allowlisted instance with the client token', async () => {
    const mock = mockBoth();
    server = await bootHttp(ENV, mock);
    const client = await server.connect({
      authorization: `Bearer ${CLIENT_TOKEN}`,
      'x-glitchtip-url': `${OTHER_URL}/`,
    });
    const result = await client.callTool({ name: 'list_organizations', arguments: {} });
    expect(resultText(result)).toContain('other-org');
    expect(mock.requests[0].url.origin).toBe(OTHER_URL);
    expect(mock.requests[0].headers.get('authorization')).toBe(`Bearer ${CLIENT_TOKEN}`);
  });

  it('refuses a URL header with the server token', async () => {
    const mock = mockBoth();
    server = await bootHttp(ENV, mock);
    const client = await server.connect({
      authorization: `Bearer ${SERVER_SECRET}`,
      'x-glitchtip-url': OTHER_URL,
    });
    const result = await client.callTool({ name: 'list_organizations', arguments: {} });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('X-GlitchTip-Url is not accepted with the server token');
    expect(mock.requests).toHaveLength(0);
  });

  it('uses X-GlitchTip-Org as the default organization', async () => {
    const mock = mockBoth().json('GET', `${ENV_URL}/api/0/organizations/picked/`, {
      slug: 'picked',
      name: 'Picked',
      dateCreated: '2026-01-01',
      access: [],
      projects: [],
      teams: [],
      openMembership: false,
      isAcceptingEvents: true,
    });
    server = await bootHttp(ENV, mock);
    const client = await server.connect({
      authorization: `Bearer ${SERVER_SECRET}`,
      'x-glitchtip-org': 'picked',
    });
    const result = await client.callTool({ name: 'get_organization', arguments: {} });
    expect(resultText(result)).toContain('slug: picked');
  });
});
