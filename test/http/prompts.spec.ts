import { afterEach, describe, expect, it } from 'vitest';
import { type BootedHttp, bootHttp } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// D-27, acceptance 10: a prompts/get POST without credentials is 401, same
// as any other MCP request (HttpAuthGuard applies before routing).

const ENV = {
  MCP_AUTH_TOKEN: 'server-secret-value',
  GLITCHTIP_URL: 'https://env.test',
  GLITCHTIP_TOKEN: 'tok_ENV',
  GLITCHTIP_TOOLSETS: 'issues,events',
};

let server: BootedHttp | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('prompts/get over HTTP (acceptance 10)', () => {
  it('answers 401 without credentials', async () => {
    server = await bootHttp(ENV, new MockGlitchTip());
    const response = await fetch(server.mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'prompts/get',
        params: { name: 'triage-issue', arguments: { issue_id: '1' } },
      }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });
});
