import { describe, expect, it } from 'vitest';
import { REDACTED, scrub, secretsFrom } from '../../../src/toolsets/alerts/alerts.secrets';
import { MockGlitchTip } from '../../support/mock-glitchtip';
import {
  ALERTS_URL,
  alertUrl,
  call,
  expectNoSecrets,
  fixtureAlerts,
  WEBHOOK_PATH,
  WEBHOOK_URL,
  ZULIP_KEY,
} from './alerts.support';

// Acceptance 6 and the "token-safety" review gate for recipient secrets: a mocked 422 whose
// detail quotes the full URL and the key comes back with [redacted]; a requests-style test
// message has its path redacted, and the alert is read before the POST.

const QUOTING_DETAIL = [
  { loc: ['body', 'url'], msg: `Invalid webhook ${WEBHOOK_URL} with key ${ZULIP_KEY}` },
];

describe('secretsFrom / scrub', () => {
  it('lists the full URL, path + query, path and host + path, longest first', () => {
    const secrets = secretsFrom([`${WEBHOOK_URL}?x=1`], [ZULIP_KEY]);
    expect(secrets).toEqual(
      expect.arrayContaining([
        `${WEBHOOK_URL}?x=1`,
        `${WEBHOOK_PATH}?x=1`,
        WEBHOOK_PATH,
        `discord.com${WEBHOOK_PATH}`,
        ZULIP_KEY,
      ]),
    );
    const lengths = secrets.map((s) => s.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });

  it('drops forms shorter than 8 characters and ignores non-strings', () => {
    expect(secretsFrom(['https://a.test/', null, 42], [undefined])).toEqual(['https://a.test/']);
  });

  it('keeps an unparsable URL whole', () => {
    expect(secretsFrom(['http://[bad secret'], [])).toEqual(['http://[bad secret']);
  });

  it('replaces every occurrence', () => {
    const secrets = secretsFrom([WEBHOOK_URL], [ZULIP_KEY]);
    expect(scrub(`${WEBHOOK_URL} ${WEBHOOK_PATH} ${ZULIP_KEY}`, secrets)).toBe(
      `${REDACTED} ${REDACTED} ${REDACTED}`,
    );
  });
});

describe('422 detail quoting secrets', () => {
  it('create_project_alert: the input URL and key are redacted', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      ALERTS_URL,
      { detail: QUOTING_DETAIL },
      { status: 422 },
    );
    const { text, isError } = await call(mock, 'create_project_alert', {
      organization: 'acme',
      project: 'web',
      recipients: [
        { type: 'discord', url: WEBHOOK_URL },
        {
          type: 'zulip',
          url: 'https://zulip.example.test',
          bot_email: 'b@zulip.example.test',
          api_key: ZULIP_KEY,
          channel: 'ops',
        },
      ],
    });
    expect(isError).toBe(true);
    expect(text).toContain(`Invalid webhook ${REDACTED} with key ${REDACTED}`);
    expectNoSecrets(text);
  });

  it('update_project_alert: the stored URL and key are redacted', async () => {
    const mock = new MockGlitchTip()
      .json('GET', ALERTS_URL, fixtureAlerts())
      .json('PUT', alertUrl(7), { detail: QUOTING_DETAIL }, { status: 422 });
    const { text, isError } = await call(mock, 'update_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      name: 'x',
    });
    expect(isError).toBe(true);
    expect(text).toContain(`Invalid webhook ${REDACTED} with key ${REDACTED}`);
    expectNoSecrets(text);
  });

  it('add_alert_recipient: a private-address rejection gets the hint', async () => {
    const url = 'https://10.0.0.1/hooks/SECRET_PRIVATE_HOOK';
    const mock = new MockGlitchTip()
      .json('GET', ALERTS_URL, fixtureAlerts())
      .json(
        'PUT',
        alertUrl(7),
        { detail: `URL ${url} resolves to a private IP address` },
        { status: 422 },
      );
    const { text, isError } = await call(mock, 'add_alert_recipient', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      recipient: { type: 'webhook', url },
    });
    expect(isError).toBe(true);
    expect(text).not.toContain('SECRET_PRIVATE_HOOK');
    expect(text).toContain(
      'GlitchTip refuses recipient URLs that resolve to private addresses unless the instance allows it.',
    );
  });
});

describe('test_project_alert delivery messages', () => {
  it('redacts a requests-style message and reads the alert before the POST', async () => {
    const message =
      "HTTPSConnectionPool(host='discord.com', port=443): Max retries exceeded with url: " +
      `${WEBHOOK_PATH} (Caused by NewConnectionError('failed'))`;
    const mock = new MockGlitchTip()
      .json('GET', ALERTS_URL, fixtureAlerts())
      .json('POST', `${alertUrl(7)}test/`, [
        { recipientType: 'discord', status: 'error', message },
        { recipientType: 'zulip', status: 'error', message: `bad key ${ZULIP_KEY}` },
      ]);
    for (const format of ['text', 'json']) {
      const { text, isError } = await call(mock, 'test_project_alert', {
        organization: 'acme',
        project: 'web',
        alert_id: 7,
        format,
      });
      expect(isError).toBe(false);
      expect(text).toContain(`Max retries exceeded with url: ${REDACTED}`);
      expect(text).toContain(`bad key ${REDACTED}`);
      expectNoSecrets(text);
    }
    expect(mock.requests.map((r) => r.method)).toEqual(['GET', 'POST', 'GET', 'POST']);
  });

  it('redacts a 4xx detail from the test POST', async () => {
    const mock = new MockGlitchTip()
      .json('GET', ALERTS_URL, fixtureAlerts())
      .json('POST', `${alertUrl(7)}test/`, { detail: `bad ${WEBHOOK_URL}` }, { status: 400 });
    const { text, isError } = await call(mock, 'test_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
    });
    expect(isError).toBe(true);
    expect(text).toContain(`bad ${REDACTED}`);
    expectNoSecrets(text);
  });
});
