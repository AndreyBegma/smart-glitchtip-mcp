import { describe, expect, it } from 'vitest';
import { jsonResponse, MockGlitchTip } from '../../support/mock-glitchtip';
import {
  ALERTS_URL,
  call,
  expectNoSecrets,
  fixtureAlerts,
  unfence,
  WEBHOOK_URL,
} from './alerts.support';

// Acceptance 3 (reads), 6 (masking in text and json): list_project_alerts and get_project_alert
// — method, path and query asserted, one error path each, recipient URLs masked.

const FENCED_DISCORD =
  '<untrusted source="glitchtip-config" field="recipient.url">https://discord.com/…</untrusted>';

describe('list_project_alerts', () => {
  it('GETs the project alert list with limit and cursor and renders masked recipients', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, fixtureAlerts(), {
      headers: {
        link: `<${ALERTS_URL}?cursor=abc>; rel="next"; results="true"; cursor="abc"`,
      },
    });
    const { text, isError } = await call(mock, 'list_project_alerts', {
      organization: 'acme',
      project: 'web',
      limit: 20,
      cursor: 'xyz',
    });
    expect(isError).toBe(false);
    const [request] = mock.requests;
    expect(request.method).toBe('GET');
    expect(request.url.pathname).toBe('/api/0/projects/acme/web/alerts/');
    expect(request.url.searchParams.get('limit')).toBe('20');
    expect(request.url.searchParams.get('cursor')).toBe('xyz');
    expect(text).toContain('name: High error rate');
    expect(text).toContain('trigger: 10 events in 5 minutes');
    expect(text).toContain(`recipient 31  discord  ${FENCED_DISCORD}`);
    expect(text).toContain("recipient 33  email  email to the project's team members");
    expect(text).toContain('channel ops topic errors bot alert-bot@zulip.example.test');
    expect(text).toContain('name: unnamed');
    expect(text).toContain('trigger: uptime failures');
    expect(text).toContain('next cursor: abc');
    expectNoSecrets(text);
  });

  it('says so when the project has no alerts', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, []);
    const { text } = await call(mock, 'list_project_alerts', {
      organization: 'acme',
      project: 'web',
    });
    expect(text).toBe('No alerts in web.');
  });

  it('masks in json too and drops the Zulip api_key', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, fixtureAlerts());
    const { text } = await call(mock, 'list_project_alerts', {
      organization: 'acme',
      project: 'web',
      format: 'json',
    });
    expect(text).toMatch(/^<untrusted source="glitchtip-config" field="alerts">/);
    const parsed = unfence(text) as { alerts: { recipients: Record<string, unknown>[] }[] };
    expect(parsed.alerts[0].recipients[0]).toMatchObject({
      id: 31,
      recipientType: 'discord',
      target: 'https://discord.com/…',
    });
    expect(parsed.alerts[0].recipients[1]).toMatchObject({
      recipientType: 'zulip',
      target: 'https://zulip.example.test',
      zulip: { botEmail: 'alert-bot@zulip.example.test', channel: 'ops', topic: 'errors' },
    });
    expect(text).not.toContain('api_key');
    expect(text).not.toContain('apiKey');
    expectNoSecrets(text);
  });

  it('names the scopes on 403', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, {}, { status: 403 });
    const { text, isError } = await call(mock, 'list_project_alerts', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(true);
    expect(text).toContain('project:read, project:write, project:admin');
  });
});

describe('get_project_alert', () => {
  it('pages the list 100 at a time until the id is found, and shows tags', async () => {
    const [seven, eight] = fixtureAlerts();
    const mock = new MockGlitchTip().on(
      'GET',
      ALERTS_URL,
      jsonResponse([eight], 200, {
        link: `<${ALERTS_URL}?cursor=p2>; rel="next"; results="true"; cursor="p2"`,
      }),
      jsonResponse([seven]),
    );
    const { text, isError } = await call(mock, 'get_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
    });
    expect(isError).toBe(false);
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[0].url.searchParams.get('limit')).toBe('100');
    expect(mock.requests[0].url.searchParams.get('cursor')).toBeNull();
    expect(mock.requests[1].url.searchParams.get('cursor')).toBe('p2');
    expect(text).toContain('alert: 7');
    expect(text).toContain('tags: environment, release');
    expect(text).not.toContain(WEBHOOK_URL);
    expectNoSecrets(text);
  });

  it('is not found when the list ends without the id', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, fixtureAlerts());
    const { text, isError } = await call(mock, 'get_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 99,
    });
    expect(isError).toBe(true);
    expect(text).toBe('Alert 99 was not found in web.');
  });

  it('stops after 10 pages and says where it stopped', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, [], {
      headers: { link: `<${ALERTS_URL}?cursor=n>; rel="next"; results="true"; cursor="n"` },
    });
    const { text, isError } = await call(mock, 'get_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 99,
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(10);
    expect(text).toBe(
      'Alert 99 was not found in the first 1000 alerts of web; the search stopped there.',
    );
  });

  it('names the project when GlitchTip answers 404', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, {}, { status: 404 });
    const { text, isError } = await call(mock, 'get_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
    });
    expect(isError).toBe(true);
    expect(text).toBe('Project web was not found in acme.');
  });

  it('refuses a project that is not a slug before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'get_project_alert', {
      organization: 'acme',
      project: '../x',
      alert_id: 7,
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });
});
