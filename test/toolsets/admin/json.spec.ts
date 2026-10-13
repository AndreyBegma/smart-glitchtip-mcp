import { describe, expect, it } from 'vitest';
import emails from '../../fixtures/admin/emails.json';
import socialApps from '../../fixtures/admin/social-apps.json';
import user from '../../fixtures/admin/user.json';
import { MockGlitchTip } from '../../support/mock-glitchtip';
import { call, closeAfterEach, URLS, unfence } from './admin.support';

// Acceptance 10: `format: "json"` is valid JSON for every read tool, fenced where the spec
// declares untrusted text, and stays valid over MCP_RESPONSE_BUDGET (the foundation budget
// cuts it; the toolset never cuts JSON itself).

closeAfterEach();

function mocks(): Record<string, () => MockGlitchTip> {
  return {
    get_current_user: () => new MockGlitchTip().json('GET', URLS.user, user),
    list_user_emails: () => new MockGlitchTip().json('GET', URLS.emails, emails),
    get_notification_settings: () =>
      new MockGlitchTip()
        .json('GET', URLS.notifications, { subscribeByDefault: true })
        .json('GET', URLS.alerts, { '3': 1 }),
    get_instance_license: () =>
      new MockGlitchTip()
        .json('GET', URLS.supportLink, { url: 'https://glitchtip.com/support#sub=LICENSE-KEY-123' })
        .json('GET', URLS.license, { billingEmail: 'billing@example.test' }),
    list_social_apps: () => new MockGlitchTip().json('GET', URLS.socialApps, socialApps),
  };
}

const FENCE: Record<string, string | undefined> = {
  get_current_user: '<untrusted source="glitchtip-user" field="user">',
  list_user_emails: '<untrusted source="glitchtip-user" field="emails">',
  list_social_apps: '<untrusted source="glitchtip-config" field="social_apps">',
  get_notification_settings: undefined,
  get_instance_license: undefined,
};

describe('format json', () => {
  it.each(Object.keys(FENCE))('%s returns parseable JSON with the declared fence', async (tool) => {
    const args = tool === 'list_social_apps' ? { organization: 'acme' } : {};
    const { text, isError } = await call(mocks()[tool](), tool, { ...args, format: 'json' });
    expect(isError).toBe(false);
    const fence = FENCE[tool];
    if (fence) expect(text.startsWith(fence)).toBe(true);
    else expect(text.startsWith('<untrusted')).toBe(false);
    expect(() => unfence(text)).not.toThrow();
  });

  it('get_current_user projects exactly the allowlist', async () => {
    const { text } = await call(mocks().get_current_user(), 'get_current_user', { format: 'json' });
    const parsed = unfence(text) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'dateJoined',
        'email',
        'hasPasswordAuth',
        'id',
        'identities',
        'isActive',
        'isSuperuser',
        'lastLogin',
        'name',
        'options',
      ].sort(),
    );
    expect(parsed.identities).toEqual([{ provider: 'google', email: 'me@idp.example.test' }]);
  });

  it('get_notification_settings lists overrides as objects', async () => {
    const { text } = await call(mocks().get_notification_settings(), 'get_notification_settings', {
      format: 'json',
    });
    expect(JSON.parse(text)).toEqual({
      subscribeByDefault: true,
      overrides: [{ projectId: 3, status: 'on' }],
    });
  });

  it('get_instance_license has no key, and the URL without its fragment', async () => {
    const { text } = await call(mocks().get_instance_license(), 'get_instance_license', {
      format: 'json',
    });
    expect(JSON.parse(text)).toEqual({
      billingEmail: 'billing@example.test',
      supportLicense: 'configured',
      supportUrl: 'https://glitchtip.com/support',
    });
  });

  it.each([
    [
      'list_user_emails',
      () =>
        new MockGlitchTip().json(
          'GET',
          URLS.emails,
          Array.from({ length: 200 }, (_, i) => ({
            isPrimary: i === 0,
            isVerified: true,
            email: `user${i}@example.test`,
          })),
        ),
      {},
    ],
    [
      'list_social_apps',
      () =>
        new MockGlitchTip().json(
          'GET',
          URLS.socialApps,
          Array.from({ length: 10 }, (_, i) => ({
            ...socialApps[0],
            id: i,
            name: 'n'.repeat(300),
          })),
        ),
      { organization: 'acme' },
    ],
    [
      'get_current_user',
      () => new MockGlitchTip().json('GET', URLS.user, { ...user, name: 'x'.repeat(5000) }),
      {},
    ],
  ])('%s stays valid JSON over the budget', async (tool, mock, args) => {
    const { text, isError } = await call(
      mock(),
      tool,
      { ...args, format: 'json' },
      { MCP_RESPONSE_BUDGET: '1000' },
    );
    expect(isError).toBe(false);
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(() => unfence(text)).not.toThrow();
  });
});
