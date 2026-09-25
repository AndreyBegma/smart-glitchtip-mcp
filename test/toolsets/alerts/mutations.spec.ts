import { describe, expect, it } from 'vitest';
import { jsonResponse, MockGlitchTip } from '../../support/mock-glitchtip';
import {
  ALERTS_URL,
  alert7,
  alertUrl,
  bodyOf,
  call,
  expectNoSecrets,
  fixtureAlerts,
  WEBHOOK_URL,
  ZULIP_KEY,
} from './alerts.support';

// Acceptance 3, 4, 7, 8: create_project_alert, update_project_alert, delete_project_alert —
// method/path/body, the read-first order of update, confirm guards and pre-request validation.

describe('create_project_alert', () => {
  it('POSTs the camelCase ProjectAlertIn and renders the returned alert masked', async () => {
    const mock = new MockGlitchTip().on('POST', ALERTS_URL, jsonResponse(alert7(), 201));
    const { text, isError } = await call(mock, 'create_project_alert', {
      organization: 'acme',
      project: 'web',
      name: 'High error rate',
      timespan_minutes: 5,
      quantity: 10,
      recipients: [
        { type: 'discord', url: WEBHOOK_URL, tags_to_add: ['environment'] },
        {
          type: 'zulip',
          url: 'https://zulip.example.test',
          bot_email: 'alert-bot@zulip.example.test',
          api_key: ZULIP_KEY,
          channel: 'ops',
        },
        { type: 'email' },
      ],
    });
    expect(isError).toBe(false);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe('POST');
    expect(bodyOf(mock.requests[0])).toEqual({
      name: 'High error rate',
      timespanMinutes: 5,
      quantity: 10,
      uptime: false,
      alertRecipients: [
        { recipientType: 'discord', url: WEBHOOK_URL, tagsToAdd: ['environment'] },
        {
          recipientType: 'zulip',
          url: 'https://zulip.example.test',
          botEmail: 'alert-bot@zulip.example.test',
          apiKey: ZULIP_KEY,
          channel: 'ops',
          topic: 'GlitchTip Alerts',
          tagsToAdd: null,
        },
        { recipientType: 'email', url: '', tagsToAdd: null },
      ],
    });
    expect(text).toContain('Created alert 7 in web.');
    expectNoSecrets(text);
  });

  it('sends an empty recipient list when none are given', async () => {
    const mock = new MockGlitchTip().on('POST', ALERTS_URL, jsonResponse(alert7(), 201));
    await call(mock, 'create_project_alert', {
      organization: 'acme',
      project: 'web',
      uptime: true,
    });
    expect(bodyOf(mock.requests[0])).toEqual({ uptime: true, alertRecipients: [] });
  });

  it('says the role may be too low on 404', async () => {
    const mock = new MockGlitchTip().json('POST', ALERTS_URL, {}, { status: 404 });
    const { text, isError } = await call(mock, 'create_project_alert', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(true);
    expect(text).toBe(
      'Could not create an alert in web: the project was not found in acme, or your organization ' +
        'role is below admin and you are not in a team of the project.',
    );
  });

  it.each([
    ['only timespan_minutes', { timespan_minutes: 5 }],
    ['only quantity', { quantity: 5 }],
    [
      'duplicate recipients',
      {
        recipients: [
          { type: 'discord', url: WEBHOOK_URL },
          { type: 'discord', url: WEBHOOK_URL },
        ],
      },
    ],
    ['two email recipients', { recipients: [{ type: 'email' }, { type: 'email' }] }],
    ['duplicate tags', { recipients: [{ type: 'email', tags_to_add: ['a', 'a'] }] }],
    ['a non-http url', { recipients: [{ type: 'webhook', url: 'ftp://example.test/x' }] }],
    ['an unparsable url', { recipients: [{ type: 'webhook', url: 'not a url' }] }],
  ])('rejects %s before any request (acceptance 8)', async (_, extra) => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'create_project_alert', {
      organization: 'acme',
      project: 'web',
      ...extra,
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
    expectNoSecrets(text);
  });
});

describe('update_project_alert', () => {
  it('reads first, then PUTs every field and every recipient as stored (acceptance 4)', async () => {
    const renamed = { ...alert7(), name: 'Renamed' };
    const mock = new MockGlitchTip()
      .json('GET', ALERTS_URL, fixtureAlerts())
      .json('PUT', alertUrl(7), renamed);
    const { text, isError } = await call(mock, 'update_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      name: 'Renamed',
    });
    expect(isError).toBe(false);
    expect(mock.requests.map((r) => r.method)).toEqual(['GET', 'PUT']);
    expect(mock.requests[1].url.pathname).toBe('/api/0/projects/acme/web/alerts/7/');
    expect(bodyOf(mock.requests[1])).toEqual({
      name: 'Renamed',
      timespanMinutes: 5,
      quantity: 10,
      uptime: false,
      alertRecipients: [
        { recipientType: 'discord', url: WEBHOOK_URL, tagsToAdd: ['environment', 'release'] },
        {
          recipientType: 'zulip',
          url: 'https://zulip.example.test',
          botEmail: 'alert-bot@zulip.example.test',
          apiKey: ZULIP_KEY,
          channel: 'ops',
          topic: 'errors',
          tagsToAdd: null,
        },
        { recipientType: 'email', url: '', tagsToAdd: [] },
      ],
    });
    expect(text).toContain('Updated alert 7 in web.');
    expect(text).toContain('name: Renamed');
    expectNoSecrets(text);
  });

  it('clears the event trigger when both halves are null', async () => {
    const mock = new MockGlitchTip()
      .json('GET', ALERTS_URL, fixtureAlerts())
      .json('PUT', alertUrl(7), alert7());
    await call(mock, 'update_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      timespan_minutes: null,
      quantity: null,
      uptime: true,
    });
    expect(bodyOf(mock.requests[1])).toMatchObject({
      timespanMinutes: null,
      quantity: null,
      uptime: true,
    });
  });

  it('refuses before the PUT when the merged trigger would have only one half', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, fixtureAlerts());
    const { text, isError } = await call(mock, 'update_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      quantity: null,
    });
    expect(isError).toBe(true);
    expect(text).toContain('timespan_minutes and quantity must be set together');
    expect(mock.requests.map((r) => r.method)).toEqual(['GET']);
  });

  it.each([
    ['nothing to update', {}],
    ['one half null, the other a number', { timespan_minutes: null, quantity: 5 }],
  ])('rejects %s before any request', async (_, extra) => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'update_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      ...extra,
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });

  it('refuses before the PUT when a stored recipient cannot be re-sent', async () => {
    const alerts = fixtureAlerts();
    alerts[0].alertRecipients.push({
      id: 34,
      recipientType: 'pager',
      url: 'https://pager.example.test/x',
      config: null,
      tagsToAdd: null,
    });
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, alerts);
    const { text, isError } = await call(mock, 'update_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      name: 'x',
    });
    expect(isError).toBe(true);
    expect(text).toContain('recipient 34 of alert 7 cannot be re-sent as stored');
    expect(text).toContain('re-sending it would delete it');
    expect(mock.requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('refuses before the PUT when a stored Zulip recipient lacks its key', async () => {
    const alerts = fixtureAlerts();
    alerts[0].alertRecipients[1].config = { bot_email: 'b@x.test', channel: 'ops' };
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, alerts);
    const { text, isError } = await call(mock, 'update_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      name: 'x',
    });
    expect(isError).toBe(true);
    expect(text).toContain('its Zulip settings are incomplete');
    expect(mock.requests).toHaveLength(1);
  });

  it('is not found, with no PUT, when the alert is not in the list', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, []);
    const { text, isError } = await call(mock, 'update_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      name: 'x',
    });
    expect(isError).toBe(true);
    expect(text).toBe('Alert 7 was not found in web.');
    expect(mock.requests).toHaveLength(1);
  });
});

describe('delete_project_alert', () => {
  it('DELETEs the alert when confirm matches', async () => {
    const mock = new MockGlitchTip().on('DELETE', alertUrl(7), jsonResponse(null, 204));
    const { text, isError } = await call(mock, 'delete_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      confirm: '7',
    });
    expect(isError).toBe(false);
    expect(mock.requests[0].method).toBe('DELETE');
    expect(mock.requests[0].url.pathname).toBe('/api/0/projects/acme/web/alerts/7/');
    expect(text).toBe('Deleted alert 7 from web.');
  });

  it.each([
    ['a wrong confirm', { alert_id: 7, confirm: '8' }],
    ['a missing confirm', { alert_id: 7 }],
    ['a missing alert_id', { confirm: '7' }],
  ])('rejects %s without any request (acceptance 7)', async (_, extra) => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'delete_project_alert', {
      organization: 'acme',
      project: 'web',
      ...extra,
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });

  it('says the role may be too low on 404', async () => {
    const mock = new MockGlitchTip().json('DELETE', alertUrl(7), {}, { status: 404 });
    const { text, isError } = await call(mock, 'delete_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      confirm: '7',
    });
    expect(isError).toBe(true);
    expect(text).toBe('Alert 7 was not found in web, or your organization role is below admin.');
  });

  it('names project:admin on 403', async () => {
    const mock = new MockGlitchTip().json('DELETE', alertUrl(7), {}, { status: 403 });
    const { text } = await call(mock, 'delete_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      confirm: '7',
    });
    expect(text).toContain('It needs one of: project:admin.');
  });
});
