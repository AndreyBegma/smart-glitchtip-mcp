import { afterEach, describe, expect, it } from 'vitest';
import { type BootedHttp, bootHttp, resultText } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// Acceptance 3 over HTTP (gate: ssrf): with an allowlisted X-GlitchTip-Url, the
// escape hatch reaches exactly that instance's /api/0/, no other origin sees a
// request, and a path naming another host is refused with no request at all.

const ENV_URL = 'https://env.test';
const OTHER_URL = 'https://other.test/prefix';
const SERVER_SECRET = 'server-secret-value';
const CLIENT_TOKEN = 'tok_CLIENT_SECRET_value';

const ENV = {
  MCP_AUTH_TOKEN: SERVER_SECRET,
  GLITCHTIP_URL: ENV_URL,
  GLITCHTIP_TOKEN: 'tok_ENV_value',
  GLITCHTIP_ALLOWED_URLS: OTHER_URL,
  GLITCHTIP_TOOLSETS: 'api_request',
};

let server: BootedHttp | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function connectToOther(mock: MockGlitchTip) {
  server = await bootHttp(ENV, mock);
  return server.connect({
    authorization: `Bearer ${CLIENT_TOKEN}`,
    'x-glitchtip-url': OTHER_URL,
  });
}

describe('api_get over HTTP with an allowlisted instance (acceptance 3)', () => {
  it('requests exactly <origin><prefix>/api/0/<path>/ on that instance', async () => {
    const mock = new MockGlitchTip().json('GET', `${OTHER_URL}/api/0/organizations/acme/`, {
      slug: 'acme',
    });
    const client = await connectToOther(mock);
    const result = await client.callTool({
      name: 'api_get',
      arguments: { path: 'organizations/acme' },
    });
    expect(result.isError).toBeFalsy();
    expect(mock.requests.map((r) => r.url.href)).toEqual([
      `${OTHER_URL}/api/0/organizations/acme/`,
    ]);
    expect(mock.requests[0].headers.get('authorization')).toBe(`Bearer ${CLIENT_TOKEN}`);
    expect(mock.unrouted).toEqual([]);
  });

  const outside = ['https://env.test/api/0/organizations/', '//env.test/x', '../../x', '%2e%2e/x'];

  it.each(outside)('refuses %s with no request to any origin', async (path) => {
    const mock = new MockGlitchTip();
    const client = await connectToOther(mock);
    const result = await client.callTool({ name: 'api_get', arguments: { path } });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('Refused before any request');
    expect(mock.requests).toEqual([]);
  });

  it('keeps the pass-through token out of results and logs', async () => {
    const mock = new MockGlitchTip().json('GET', `${OTHER_URL}/api/0/`, {
      auth: { token: CLIENT_TOKEN },
      detail: `Bearer ${CLIENT_TOKEN}`,
    });
    const client = await connectToOther(mock);
    const result = await client.callTool({ name: 'api_get', arguments: { path: '' } });
    expect(JSON.stringify(result)).not.toContain(CLIENT_TOKEN);
    expect(server?.logs()).not.toContain(CLIENT_TOKEN);
  });
});
