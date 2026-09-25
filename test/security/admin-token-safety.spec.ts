import { afterEach, describe, expect, it } from 'vitest';
import degradedSocialApps from '../fixtures/admin/degraded-social-apps.json';
import socialApps from '../fixtures/admin/social-apps.json';
import user from '../fixtures/admin/user.json';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../support/boot';
import { jsonResponse, MockGlitchTip, type RecordedRequest } from '../support/mock-glitchtip';

// Acceptance 4 — the token-safety gate of the admin toolset:
// - no admin tool, in any call this file makes, reaches a withheld route (D-23);
// - the license key never appears, in text or json;
// - chatwootIdentifierHash, identity uid, clientSecret and secret are never rendered;
// - the configured token, placed in a GlitchTip error body and in a response field (rendered
//   and unrendered), is in no tool result and no log line.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_ADMIN_SAFETY_9f8e7d6c5b4a';
const LICENSE_KEY = 'LICENSE-KEY-123';

const URLS = {
  user: `${API}/users/me/`,
  emails: `${API}/users/me/emails/`,
  notifications: `${API}/users/me/notifications/`,
  alerts: `${API}/users/me/notifications/alerts/`,
  license: `${API}/instance-license/`,
  supportLink: `${API}/instance-license/support-link/`,
  socialApps: `${API}/organizations/acme/social-apps/`,
  socialApp: `${API}/organizations/acme/social-apps/3/`,
};

const WITHHELD_PATH = /api-tokens|generate-recovery-codes|wizard|\/accept\//;

interface Case {
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

const CASES: readonly Case[] = [
  { tool: 'get_current_user', args: {} },
  { tool: 'list_user_emails', args: {} },
  { tool: 'get_notification_settings', args: {} },
  { tool: 'get_instance_license', args: {} },
  { tool: 'list_social_apps', args: { organization: 'acme' } },
  { tool: 'update_current_user', args: { timezone: 'UTC' } },
  { tool: 'update_notification_settings', args: { subscribe_by_default: true } },
  { tool: 'set_project_alert_notification', args: { project_id: 4, mode: 'on' } },
  { tool: 'delete_social_app', args: { organization: 'acme', social_app_id: 3, confirm: '3' } },
];

/** Every route answering success, with the token inside rendered and unrendered fields. */
function succeedingWithToken(): MockGlitchTip {
  const leakyUser = { ...user, name: `Name ${TOKEN}`, token: TOKEN };
  return new MockGlitchTip()
    .json('GET', URLS.user, leakyUser)
    .json('PUT', URLS.user, leakyUser)
    .json('GET', URLS.emails, [
      { email: `${TOKEN}@example.test`, isPrimary: true, isVerified: true, token: TOKEN },
    ])
    .json('GET', URLS.notifications, { subscribeByDefault: true, token: TOKEN })
    .json('PUT', URLS.notifications, { subscribeByDefault: true, token: TOKEN })
    .json('GET', URLS.alerts, { '4': 1, [TOKEN]: 1 })
    .on('PUT', URLS.alerts, jsonResponse(null, 204))
    .json('GET', URLS.supportLink, {
      url: `https://glitchtip.com/support?t=${TOKEN}#sub=${LICENSE_KEY}`,
    })
    .json('GET', URLS.license, { billingEmail: `billing ${TOKEN}`, token: TOKEN })
    .json('GET', URLS.socialApps, [{ ...socialApps[0], name: TOKEN, clientSecret: TOKEN }])
    .on('DELETE', URLS.socialApp, jsonResponse(null, 204));
}

/**
 * Every route failing, with the token echoed in GlitchTip's detail. The license route
 * echoes the license key too: get_instance_license learns it from the support link first
 * and must scrub it (no other tool ever sees the key).
 */
function failingWithToken(status: number): MockGlitchTip {
  const body = { detail: `Invalid ${TOKEN}` };
  const mock = new MockGlitchTip();
  for (const [method, url] of [
    ['GET', URLS.user],
    ['PUT', URLS.user],
    ['GET', URLS.emails],
    ['GET', URLS.notifications],
    ['PUT', URLS.notifications],
    ['GET', URLS.alerts],
    ['PUT', URLS.alerts],
    ['GET', URLS.socialApps],
    ['DELETE', URLS.socialApp],
  ] as const) {
    mock.json(method, url, body, { status });
  }
  mock.json('GET', URLS.license, { detail: `Invalid ${TOKEN} / ${LICENSE_KEY}` }, { status });
  mock.json('GET', URLS.supportLink, { url: `https://glitchtip.com/support#sub=${LICENSE_KEY}` });
  return mock;
}

const allRequests: RecordedRequest[] = [];
let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function run(mock: MockGlitchTip, { tool, args }: Case, format: 'text' | 'json') {
  booted = await bootInMemory(
    {
      GLITCHTIP_TOKEN: TOKEN,
      GLITCHTIP_TOOLSETS: 'admin',
      GLITCHTIP_READ_ONLY: 'false',
      LOG_LEVEL: 'trace',
    },
    mock,
  );
  const result = await booted.client.callTool({ name: tool, arguments: { ...args, format } });
  allRequests.push(...mock.requests);
  return { text: resultText(result), isError: result.isError === true, logs: booted.logs() };
}

function expectClean(label: string, text: string): void {
  expect(text, label).not.toContain(TOKEN);
  expect(text, label).not.toContain(LICENSE_KEY);
}

describe('admin token safety', () => {
  describe.each(['text', 'json'] as const)('format %s', (format) => {
    it.each(CASES)(
      '$tool: the token in response fields never reaches the result or log',
      async (c) => {
        const { text, isError, logs } = await run(succeedingWithToken(), c, format);
        expect(isError, text).toBe(false);
        expectClean(`${c.tool} result`, text);
        expectClean(`${c.tool} log`, logs);
      },
    );

    it.each(CASES)(
      '$tool: the token in an error body never reaches the result or log',
      async (c) => {
        for (const status of [400, 403, 500]) {
          const { text, isError, logs } = await run(failingWithToken(status), c, format);
          expect(isError, `${c.tool} ${status}`).toBe(true);
          expectClean(`${c.tool} ${status} result`, text);
          expectClean(`${c.tool} ${status} log`, logs);
          await booted?.close();
          booted = undefined;
        }
      },
    );
  });

  it('get_instance_license reports configured and never outputs the key', async () => {
    for (const format of ['text', 'json'] as const) {
      const mock = new MockGlitchTip()
        .json('GET', URLS.supportLink, { url: `https://glitchtip.com/support#sub=${LICENSE_KEY}` })
        .json('GET', URLS.license, { billingEmail: 'billing@example.test' });
      const { text } = await run(mock, { tool: 'get_instance_license', args: {} }, format);
      expect(text).toContain('configured');
      expect(text).not.toContain('not configured');
      expect(text).not.toContain(LICENSE_KEY);
      expect(text).not.toContain('#sub=');
      await booted?.close();
      booted = undefined;
    }
  });

  it('get_current_user never outputs chatwootIdentifierHash or an identity uid', async () => {
    for (const format of ['text', 'json'] as const) {
      const mock = new MockGlitchTip().json('GET', URLS.user, user);
      const { text } = await run(mock, { tool: 'get_current_user', args: {} }, format);
      expect(text).toContain('me@example.test');
      expect(text).not.toContain(user.chatwootIdentifierHash);
      expect(text).not.toContain(user.identities[0].uid);
      await booted?.close();
      booted = undefined;
    }
  });

  it('list_social_apps never outputs clientSecret or secret', async () => {
    for (const format of ['text', 'json'] as const) {
      const mock = new MockGlitchTip().json('GET', URLS.socialApps, degradedSocialApps);
      const { text } = await run(
        mock,
        { tool: 'list_social_apps', args: { organization: 'acme' } },
        format,
      );
      expect(text).toContain('Leaky SSO');
      for (const secret of [
        'CLIENT-SECRET-XYZ-0001',
        'RAW-SECRET-ABC-0002',
        'TOKEN-FIELD-QQQ-0003',
      ]) {
        expect(text).not.toContain(secret);
      }
      await booted?.close();
      booted = undefined;
    }
  });

  // Last in the file: it reads every request the cases above recorded.
  it('no admin tool call in this file reached a withheld route', () => {
    expect(allRequests.length).toBeGreaterThan(CASES.length);
    const tools = new Set(allRequests.map((r) => r.url.pathname));
    expect([...tools].filter((path) => WITHHELD_PATH.test(path))).toEqual([]);
    expect(WITHHELD_PATH.test('/api/0/api-tokens/')).toBe(true);
    expect(WITHHELD_PATH.test('/api/0/accept/1/abc/')).toBe(true);
    // User deletion and every e-mail change are withheld too (D-23): the user is never
    // deleted, and the e-mail route is only ever read.
    const calls = allRequests.map((r) => `${r.method} ${r.url.pathname}`);
    expect(calls).not.toContain('DELETE /api/0/users/me/');
    const emailCalls = allRequests.filter((r) =>
      r.url.pathname.startsWith('/api/0/users/me/emails'),
    );
    expect(emailCalls.length).toBeGreaterThan(0);
    expect(
      emailCalls.every((r) => r.method === 'GET' && r.url.pathname === '/api/0/users/me/emails/'),
    ).toBe(true);
  });
});
