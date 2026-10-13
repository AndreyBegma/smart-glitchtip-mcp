import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// D-27, acceptance 8 and 9. D-18: the rules block is present in every
// prompt's text, its first rule naming the `<untrusted …>` tags, and the
// GlitchTip mock sees zero requests across `prompts/list` and every
// `prompts/get` in this suite — a prompt makes no GlitchTip call. Secrets: no
// response or captured stderr contains the token, the auth token, the
// instance URL or the default organization.

const TOKEN = 'sentinel-glitchtip-token';
const AUTH_TOKEN = 'sentinel-mcp-auth-token';
const URL_SENTINEL = 'https://secret-host.test';
const DEFAULT_ORG = 'hidden-org';

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

interface GetPromptResult {
  readonly description?: string;
  readonly messages: readonly { content: { text: string } }[];
}

describe('D-18: rules block, and no GlitchTip call (acceptance 8)', () => {
  it('makes zero requests to the mock across prompts/list and every prompts/get', async () => {
    const mock = new MockGlitchTip();
    booted = await bootInMemory(
      { GLITCHTIP_TOKEN: 'tok', GLITCHTIP_TOOLSETS: 'releases,issues,events' },
      mock,
    );

    const { prompts } = await booted.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['release-health-report', 'triage-issue']);

    const calls: Promise<unknown>[] = [
      booted.client.request({
        method: 'prompts/get',
        params: { name: 'triage-issue', arguments: { issue_id: '42', organization: 'acme' } },
      }),
      booted.client.request({
        method: 'prompts/get',
        params: { name: 'release-health-report', arguments: { version: '1.0.0', project: 'web' } },
      }),
      booted.client.request({
        method: 'prompts/get',
        params: { name: 'release-health-report', arguments: { version: '1.0 beta' } },
      }),
    ];
    const results = (await Promise.all(calls)) as GetPromptResult[];
    for (const result of results) {
      const text = result.messages[0].content.text;
      expect(text.split('\n')).toContainEqual('Rules for this task:');
      const rulesAt = text.indexOf('Rules for this task:');
      const firstRule = text.slice(rulesAt).split('\n')[1];
      expect(firstRule).toContain('<untrusted');
    }
    expect(mock.requests).toEqual([]);
    expect(mock.unrouted).toEqual([]);
  });
});

describe('secrets never reach a prompt response or the log (acceptance 9)', () => {
  it('leaks none of GLITCHTIP_TOKEN, MCP_AUTH_TOKEN, GLITCHTIP_URL or GLITCHTIP_DEFAULT_ORG', async () => {
    const mock = new MockGlitchTip();
    booted = await bootInMemory(
      {
        GLITCHTIP_TOKEN: TOKEN,
        MCP_AUTH_TOKEN: AUTH_TOKEN,
        GLITCHTIP_URL: URL_SENTINEL,
        GLITCHTIP_DEFAULT_ORG: DEFAULT_ORG,
        GLITCHTIP_TOOLSETS: 'releases,issues,events',
      },
      mock,
    );

    const list = await booted.client.listPrompts();
    const triage = (await booted.client.request({
      method: 'prompts/get',
      params: { name: 'triage-issue', arguments: { issue_id: '1' } },
    })) as GetPromptResult;
    const release = (await booted.client.request({
      method: 'prompts/get',
      params: { name: 'release-health-report', arguments: { version: '1.0.0' } },
    })) as GetPromptResult;
    const invalid = await booted.client
      .request({
        method: 'prompts/get',
        params: { name: 'triage-issue', arguments: { issue_id: 'not-a-number' } },
      })
      .catch((error: unknown) => error);
    expect(invalid).toMatchObject({ code: -32602 });

    const serialised = JSON.stringify([list, triage, release, invalid]);
    const logs = booted.logs();
    for (const secret of [TOKEN, AUTH_TOKEN, URL_SENTINEL, DEFAULT_ORG]) {
      expect(serialised).not.toContain(secret);
      expect(logs).not.toContain(secret);
    }
  });
});
