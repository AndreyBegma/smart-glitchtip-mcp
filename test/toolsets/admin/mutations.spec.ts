import { describe, expect, it } from 'vitest';
import user from '../../fixtures/admin/user.json';
import { jsonResponse, MockGlitchTip } from '../../support/mock-glitchtip';
import { call, closeAfterEach, URLS } from './admin.support';

// Acceptance 3 (writes), 5, 6, 7 and AGENTS.md rule 15: bodies asserted exactly, the
// read-then-write re-sends every stored field, a partial read writes nothing, the alert
// override sends one key, and a wrong confirm makes no request.

closeAfterEach();

const { chatwootIdentifierHash: _hash, ...updatedUser } = user;

function userMock(stored: unknown, updated: unknown = updatedUser): MockGlitchTip {
  return new MockGlitchTip().json('GET', URLS.user, stored).json('PUT', URLS.user, updated);
}

describe('update_current_user', () => {
  it('GETs then PUTs, re-sending every stored field besides the one changed', async () => {
    const mock = userMock(user, {
      ...updatedUser,
      options: { ...user.options, timezone: 'Asia/Tokyo' },
    });
    const { text, isError } = await call(mock, 'update_current_user', { timezone: 'Asia/Tokyo' });
    expect(isError).toBe(false);
    expect(mock.requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      'GET /api/0/users/me/',
      'PUT /api/0/users/me/',
    ]);
    expect(JSON.parse(mock.requests[1].body)).toEqual({
      name: 'Me Person',
      options: {
        timezone: 'Asia/Tokyo',
        stacktraceOrder: 1,
        language: 'en',
        clock24Hours: true,
        preferredTheme: 'dark',
      },
    });
    expect(text).toContain('>Asia/Tokyo</untrusted>');
  });

  it('re-sends stored nulls as null and applies name: null', async () => {
    const stored = {
      ...user,
      name: 'Old',
      options: {
        timezone: null,
        stacktraceOrder: null,
        language: null,
        clock24Hours: null,
        preferredTheme: null,
      },
    };
    const mock = userMock(stored);
    await call(mock, 'update_current_user', { name: null, clock_24_hours: false });
    expect(JSON.parse(mock.requests[1].body)).toEqual({
      name: null,
      options: {
        timezone: null,
        stacktraceOrder: null,
        language: null,
        clock24Hours: false,
        preferredTheme: null,
      },
    });
  });

  it.each([
    ['options.language', { ...user, options: { ...user.options, language: undefined } }],
    [
      'options.stacktraceOrder',
      { ...user, options: { ...user.options, stacktraceOrder: undefined } },
    ],
    ['options', { ...user, options: undefined }],
    ['name', { ...user, name: undefined }],
    ['options.clock24Hours', { ...user, options: { ...user.options, clock24Hours: 'yes' } }],
  ])('refuses without a PUT when the read lacks %s', async (field, stored) => {
    const mock = userMock(JSON.parse(JSON.stringify(stored)));
    const { text, isError } = await call(mock, 'update_current_user', { timezone: 'UTC' });
    expect(isError).toBe(true);
    expect(text).toContain(`\`${field}\``);
    expect(text).toMatch(/^Not updated:/);
    expect(mock.requests.filter((r) => r.method === 'PUT')).toEqual([]);
  });

  it('does not need a stored value for the field it sets', async () => {
    const stored = JSON.parse(JSON.stringify({ ...user, name: undefined }));
    const mock = userMock(stored);
    const { isError } = await call(mock, 'update_current_user', { name: 'New' });
    expect(isError).toBe(false);
    expect(JSON.parse(mock.requests[1].body).name).toBe('New');
  });

  it('refuses an empty update before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError, text } = await call(mock, 'update_current_user', {});
    expect(isError).toBe(true);
    expect(text).toContain('nothing to update');
    expect(mock.requests).toEqual([]);
  });

  it('refuses an empty string before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'update_current_user', { language: '' });
    expect(isError).toBe(true);
    expect(mock.requests).toEqual([]);
  });

  it('maps a 400 on the PUT to the rejection message', async () => {
    const mock = new MockGlitchTip()
      .json('GET', URLS.user, user)
      .json('PUT', URLS.user, { detail: 'bad timezone' }, { status: 400 });
    const { text, isError } = await call(mock, 'update_current_user', { timezone: 'Mars/Base' });
    expect(isError).toBe(true);
    expect(text).toBe('GlitchTip rejected the request: bad timezone');
  });
});

describe('update_notification_settings', () => {
  it('PUTs exactly subscribeByDefault and shows the returned value', async () => {
    const mock = new MockGlitchTip().json('PUT', URLS.notifications, { subscribeByDefault: false });
    const { text, isError } = await call(mock, 'update_notification_settings', {
      subscribe_by_default: false,
    });
    expect(isError).toBe(false);
    expect(mock.requests[0].method).toBe('PUT');
    expect(mock.requests[0].url.pathname).toBe('/api/0/users/me/notifications/');
    expect(JSON.parse(mock.requests[0].body)).toEqual({ subscribeByDefault: false });
    expect(text).toBe('Subscribe to new projects by default: no.');
  });

  it('requires subscribe_by_default; no request without it', async () => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'update_notification_settings', {});
    expect(isError).toBe(true);
    expect(mock.requests).toEqual([]);
  });

  it('reports a 404 as an inactive or deleted user', async () => {
    const mock = new MockGlitchTip().json('PUT', URLS.notifications, {}, { status: 404 });
    const { text, isError } = await call(mock, 'update_notification_settings', {
      subscribe_by_default: true,
    });
    expect(isError).toBe(true);
    expect(text).toMatch(/inactive or no longer exists/);
  });
});

describe('set_project_alert_notification', () => {
  it.each([
    ['default', -1],
    ['on', 1],
    ['off', 0],
  ])('mode %s sends exactly one key with %i', async (mode, code) => {
    const mock = new MockGlitchTip().on('PUT', URLS.alerts, jsonResponse(null, 204));
    const { text, isError } = await call(mock, 'set_project_alert_notification', {
      project_id: 42,
      mode,
    });
    expect(isError).toBe(false);
    expect(mock.requests[0].url.pathname).toBe('/api/0/users/me/notifications/alerts/');
    expect(JSON.parse(mock.requests[0].body)).toEqual({ '42': code });
    expect(text).toBe(`Alert notifications for project 42 set to ${mode}.`);
  });

  it('refuses a non-positive project id before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'set_project_alert_notification', {
      project_id: 0,
      mode: 'on',
    });
    expect(isError).toBe(true);
    expect(mock.requests).toEqual([]);
  });

  it('names the project on 404', async () => {
    const mock = new MockGlitchTip().json('PUT', URLS.alerts, {}, { status: 404 });
    const { text, isError } = await call(mock, 'set_project_alert_notification', {
      project_id: 42,
      mode: 'off',
    });
    expect(isError).toBe(true);
    expect(text).toContain('project 42 is not visible to the current user');
  });
});

describe('delete_social_app', () => {
  it('DELETEs the app when confirm matches', async () => {
    const mock = new MockGlitchTip().on('DELETE', URLS.socialApp(3), jsonResponse(null, 204));
    const { text, isError } = await call(mock, 'delete_social_app', {
      organization: 'acme',
      social_app_id: 3,
      confirm: '3',
    });
    expect(isError).toBe(false);
    expect(mock.requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      'DELETE /api/0/organizations/acme/social-apps/3/',
    ]);
    expect(text).toBe('Deleted SSO app 3 from acme.');
  });

  it.each([
    ['a wrong confirm', { confirm: '4' }],
    ['a padded confirm', { confirm: ' 3' }],
    ['a missing confirm', {}],
  ])('makes no request with %s', async (_label, extra) => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'delete_social_app', {
      organization: 'acme',
      social_app_id: 3,
      ...extra,
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });

  it('names the app on 404', async () => {
    const mock = new MockGlitchTip().json('DELETE', URLS.socialApp(3), {}, { status: 404 });
    const { text } = await call(mock, 'delete_social_app', {
      organization: 'acme',
      social_app_id: 3,
      confirm: '3',
    });
    expect(text).toBe('SSO app 3 was not found in acme.');
  });

  it('names the write scope and the role on 403', async () => {
    const mock = new MockGlitchTip().json('DELETE', URLS.socialApp(3), {}, { status: 403 });
    const { text } = await call(mock, 'delete_social_app', {
      organization: 'acme',
      social_app_id: 3,
      confirm: '3',
    });
    expect(text).toBe(
      'The token lacks permission for delete SSO app. It needs scope org:write or org:admin ' +
        'and the manager, admin or owner role in acme.',
    );
  });
});
