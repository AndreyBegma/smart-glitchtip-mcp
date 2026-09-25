import { describe, expect, it } from 'vitest';
import degraded from '../../fixtures/alerts/degraded-alerts.json';
import structural from '../../fixtures/alerts/structural-alerts.json';
import { MockGlitchTip } from '../../support/mock-glitchtip';
import { ALERTS_URL, call, capturedLogs, expectNoSecrets } from './alerts.support';

// Acceptance 10: a missing optional part degrades inside the formatter and is marked `?`
// (including a recipient URL that does not parse); a structural break is the `malformed` tool
// error naming the tool. Neither says "Internal error", and neither leaks a secret to stderr.

const MALFORMED = /^GlitchTip returned a response this server did not expect for/;

describe('list_project_alerts', () => {
  it('renders a degraded payload with the gaps marked', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, degraded);
    const { text, isError } = await call(mock, 'list_project_alerts', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(false);
    expect(text).toContain('trigger: ? events in 5 minutes');
    expect(text).toMatch(/recipient 41 {2}webhook {2}<untrusted[^>]*>\?<\/untrusted>/);
    expect(text).toContain('recipient 42  discord');
    expect(text).toContain('unparsable URL (masked)');
    expect(text).toContain('recipient 43  pager');
    expect(text).toContain('https://pager.example.test/…');
    expect(text).toContain('channel ? topic ? bot ?');
    expect(text).toContain("recipients: none (GlitchTip emails the project's team members)");
    expect(text).not.toContain('Internal error');
  });

  it('is the malformed tool error naming the tool when alertRecipients is not a list', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, structural);
    const { text, isError } = await call(mock, 'list_project_alerts', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('list_project_alerts');
    expect(text).not.toContain('Internal error');
    expectNoSecrets(text);
    expect(capturedLogs()).toContain('TypeError');
  });

  it('is malformed, never an empty list, when the page is not an array', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, { alerts: [] });
    const { text, isError } = await call(mock, 'list_project_alerts', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(true);
    expect(text).toContain('something other than a list');
    expect(text).not.toContain('Internal error');
  });
});

describe('get_project_alert', () => {
  it('renders a degraded alert in json with the gaps marked', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, degraded);
    const { text, isError } = await call(mock, 'get_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 9,
      format: 'json',
    });
    expect(isError).toBe(false);
    expect(text).toContain('"target": "?"');
    expect(text).toContain('"target": "unparsable URL (masked)"');
    expect(text).not.toContain('Internal error');
  });

  it('is the malformed tool error naming the tool when alertRecipients is not a list', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, structural);
    const { text, isError } = await call(mock, 'get_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 11,
    });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('get_project_alert');
    expect(text).not.toContain('Internal error');
    expectNoSecrets(text);
  });
});

describe('read-first of a mutation', () => {
  it('refuses, and does not PUT, when the stored recipients are not a list', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, structural);
    const { text, isError } = await call(mock, 'update_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 11,
      name: 'x',
    });
    expect(isError).toBe(true);
    expect(text).toContain('re-sending it would delete it');
    expect(mock.requests.map((r) => r.method)).toEqual(['GET']);
    expectNoSecrets(text);
  });

  it('refuses a recipient with no URL rather than guess', async () => {
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, degraded);
    const { text, isError } = await call(mock, 'remove_alert_recipient', {
      organization: 'acme',
      project: 'web',
      alert_id: 9,
      recipient_id: 44,
      confirm: '44',
    });
    expect(isError).toBe(true);
    expect(text).toContain('recipient 41 of alert 9 cannot be re-sent as stored');
    expect(mock.requests).toHaveLength(1);
  });
});
