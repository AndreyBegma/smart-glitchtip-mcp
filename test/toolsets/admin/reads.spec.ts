import { describe, expect, it } from 'vitest';
import emails from '../../fixtures/admin/emails.json';
import socialApps from '../../fixtures/admin/social-apps.json';
import user from '../../fixtures/admin/user.json';
import { MockGlitchTip } from '../../support/mock-glitchtip';
import { call, closeAfterEach, URLS } from './admin.support';

// Acceptance 3 (reads): method and path of every read tool — always `/users/me/…` for user
// tools — the rendered allowlist, the fences, and one error path each.

closeAfterEach();

describe('get_current_user', () => {
  it('GETs /users/me/ and renders the allowlisted fields, fenced', async () => {
    const mock = new MockGlitchTip().json('GET', URLS.user, user);
    const { text, isError } = await call(mock, 'get_current_user');
    expect(isError).toBe(false);
    expect(mock.requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      'GET /api/0/users/me/',
    ]);
    expect(text).toContain('id: 1');
    expect(text).toContain(
      'email: <untrusted source="glitchtip-user" field="user.email">me@example.test</untrusted>',
    );
    expect(text).toContain(
      'name: <untrusted source="glitchtip-user" field="user.name">Me Person</untrusted>',
    );
    expect(text).toContain('date joined: 2026-01-01');
    expect(text).toContain('superuser: no');
    expect(text).toContain('password sign-in: yes');
    expect(text).toContain('identities: 1');
    expect(text).toContain(
      '<untrusted source="glitchtip-config" field="identity.provider">google</untrusted>',
    );
    expect(text).toContain('stacktrace order: 1');
    expect(text).toContain('24-hour clock: yes');
    expect(text).not.toContain('CHATWOOT');
    expect(text).not.toContain('UID-SECRET');
  });

  it('reports a 404 as an inactive or deleted user', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      URLS.user,
      { detail: 'Not Found' },
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'get_current_user');
    expect(isError).toBe(true);
    expect(text).toMatch(/the user is inactive or no longer exists/);
  });

  it('reports a 401 with the foundation message', async () => {
    const mock = new MockGlitchTip().json('GET', URLS.user, { detail: 'nope' }, { status: 401 });
    const { text, isError } = await call(mock, 'get_current_user');
    expect(isError).toBe(true);
    expect(text).toBe('The GlitchTip token was rejected (401). Check the token.');
  });
});

describe('list_user_emails', () => {
  it('GETs /users/me/emails/ and shows primary and verified', async () => {
    const mock = new MockGlitchTip().json('GET', URLS.emails, emails);
    const { text, isError } = await call(mock, 'list_user_emails');
    expect(isError).toBe(false);
    expect(mock.requests[0].method).toBe('GET');
    expect(mock.requests[0].url.pathname).toBe('/api/0/users/me/emails/');
    expect(text).toContain('2 e-mail address(es):');
    expect(text).toContain(
      '- <untrusted source="glitchtip-user" field="user.email">me@example.test</untrusted>  primary: yes  verified: yes',
    );
    expect(text).toContain('alt@example.test</untrusted>  primary: no  verified: no');
  });

  it('says so when there are none, without isError', async () => {
    const mock = new MockGlitchTip().json('GET', URLS.emails, []);
    const { text, isError } = await call(mock, 'list_user_emails');
    expect(isError).toBe(false);
    expect(text).toBe('No e-mail addresses on the current user.');
  });

  it('reports a 5xx as a tool error', async () => {
    const mock = new MockGlitchTip().json('GET', URLS.emails, {}, { status: 503 });
    const { text, isError } = await call(
      mock,
      'list_user_emails',
      {},
      { GLITCHTIP_TIMEOUT_MS: '100' },
    );
    expect(isError).toBe(true);
    expect(text).toBe('GlitchTip returned 503.');
  });
});

describe('get_notification_settings', () => {
  it('GETs both routes and lists overrides as on/off', async () => {
    const mock = new MockGlitchTip()
      .json('GET', URLS.notifications, { subscribeByDefault: true })
      .json('GET', URLS.alerts, { '12': 0, '7': 1 });
    const { text, isError } = await call(mock, 'get_notification_settings');
    expect(isError).toBe(false);
    expect(mock.requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      'GET /api/0/users/me/notifications/',
      'GET /api/0/users/me/notifications/alerts/',
    ]);
    expect(text).toBe(
      'subscribe by default: yes\nper-project overrides:\nproject 7: on\nproject 12: off',
    );
  });

  it('still succeeds when the overrides read fails, naming why', async () => {
    const mock = new MockGlitchTip()
      .json('GET', URLS.notifications, { subscribeByDefault: false })
      .json('GET', URLS.alerts, { detail: 'boom' }, { status: 400 });
    const { text, isError } = await call(mock, 'get_notification_settings');
    expect(isError).toBe(false);
    expect(text).toBe(
      'subscribe by default: no\nPer-project overrides unavailable: GlitchTip rejected the request: boom',
    );
  });

  it('flattens a multi-line GlitchTip detail in the unavailable note to one line', async () => {
    const mock = new MockGlitchTip()
      .json('GET', URLS.notifications, { subscribeByDefault: true })
      .json('GET', URLS.alerts, { detail: 'line one\nline two' }, { status: 400 });
    const { text } = await call(mock, 'get_notification_settings');
    expect(text.split('\n')).toEqual([
      'subscribe by default: yes',
      'Per-project overrides unavailable: GlitchTip rejected the request: line one line two',
    ]);
  });

  it('fails when the settings read fails', async () => {
    const mock = new MockGlitchTip().json('GET', URLS.notifications, {}, { status: 404 });
    const { text, isError } = await call(mock, 'get_notification_settings');
    expect(isError).toBe(true);
    expect(text).toMatch(/inactive or no longer exists/);
  });
});

describe('get_instance_license', () => {
  it('GETs both routes; strips the fragment and reports configured', async () => {
    const mock = new MockGlitchTip()
      .json('GET', URLS.supportLink, { url: 'https://glitchtip.com/support#sub=LICENSE-KEY-123' })
      .json('GET', URLS.license, { billingEmail: 'billing@example.test' });
    const { text, isError } = await call(mock, 'get_instance_license');
    expect(isError).toBe(false);
    expect(mock.requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      'GET /api/0/instance-license/support-link/',
      'GET /api/0/instance-license/',
    ]);
    expect(text).toBe(
      [
        'billing email: <untrusted source="glitchtip-config" field="license.billingEmail">billing@example.test</untrusted>',
        'support license: configured',
        'support URL: <untrusted source="glitchtip-config" field="license.supportUrl">https://glitchtip.com/support</untrusted>',
      ].join('\n'),
    );
  });

  it('reports not configured and no billing email', async () => {
    const mock = new MockGlitchTip()
      .json('GET', URLS.supportLink, { url: 'https://glitchtip.com/support' })
      .json('GET', URLS.license, { billingEmail: '' });
    const { text } = await call(mock, 'get_instance_license');
    expect(text).toContain('billing email: none');
    expect(text).toContain('support license: not configured');
  });

  it('degrades when the support link read fails', async () => {
    const mock = new MockGlitchTip()
      .json('GET', URLS.supportLink, {}, { status: 403 })
      .json('GET', URLS.license, { billingEmail: 'billing@example.test' });
    const { text, isError } = await call(mock, 'get_instance_license');
    expect(isError).toBe(false);
    expect(text).toContain('support license: unknown (support link unavailable: The token lacks');
  });

  it('fails when the license read fails', async () => {
    const mock = new MockGlitchTip()
      .json('GET', URLS.supportLink, { url: 'https://glitchtip.com/support' })
      .json('GET', URLS.license, { detail: 'x' }, { status: 401 });
    const { text, isError } = await call(mock, 'get_instance_license');
    expect(isError).toBe(true);
    expect(text).toMatch(/^The GlitchTip token was rejected/);
  });
});

describe('list_social_apps', () => {
  it('GETs the organization route and renders every allowlisted field, fenced as config', async () => {
    const mock = new MockGlitchTip().json('GET', URLS.socialApps, socialApps);
    const { text, isError } = await call(mock, 'list_social_apps', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(mock.requests[0].method).toBe('GET');
    expect(mock.requests[0].url.pathname).toBe('/api/0/organizations/acme/social-apps/');
    expect(text).toContain('1 SSO app(s) in acme:');
    expect(text).toContain(
      '- SSO app 3: <untrusted source="glitchtip-config" field="social_app.name">Corp SSO</untrusted>',
    );
    for (const value of [
      'openid_connect',
      'keycloak',
      'https://idp.example.test/realms/corp',
      'https://glitchtip.test/auth/oidc/corp/login/',
      'https://glitchtip.test/auth/oidc/corp/login/callback/',
      'glitchtip-client-123',
    ]) {
      expect(text).toContain(`>${value}</untrusted>`);
    }
  });

  it('says so when there are none', async () => {
    const mock = new MockGlitchTip().json('GET', URLS.socialApps, []);
    const { text } = await call(mock, 'list_social_apps', { organization: 'acme' });
    expect(text).toBe('No SSO apps in acme.');
  });

  it('names the scope and the role on 403', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      URLS.socialApps,
      { detail: 'forbidden' },
      { status: 403 },
    );
    const { text, isError } = await call(mock, 'list_social_apps', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toBe(
      'The token lacks permission for list SSO apps. It needs scope org:read, org:write or ' +
        'org:admin and the manager, admin or owner role in acme.',
    );
  });
});
