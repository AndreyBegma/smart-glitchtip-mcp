import { describe, expect, it } from 'vitest';
import { REDACTED, scrub, secretsFrom } from '../../../src/toolsets/alerts/alerts.secrets';
import { MockGlitchTip } from '../../support/mock-glitchtip';
import {
  ALERTS_URL,
  type Alert,
  alertUrl,
  call,
  expectNoSecrets,
  fixtureAlerts,
} from './alerts.support';

// Security review of PR #30, each finding in the reviewer's probe shape: a secret cut off by the
// foundation's 500-character detail limit (1), a missing or null recipient list (2), missing
// scalars (3), short and encoded URL forms (4, 5), non-numeric ids and counts (6), the Zulip
// topic and config keys (7, 9).

const LONG_TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghij';
const LONG_HOOK = `https://discord.com/api/webhooks/99/${LONG_TOKEN}`;

function alertsWith(change: (alert: Alert) => void): Alert[] {
  const alerts = fixtureAlerts();
  change(alerts[0]);
  return alerts;
}

async function update(alerts: unknown) {
  const mock = new MockGlitchTip().json('GET', ALERTS_URL, alerts).json('PUT', alertUrl(7), {});
  const result = await call(mock, 'update_project_alert', {
    organization: 'acme',
    project: 'web',
    alert_id: 7,
    name: 'x',
  });
  return { ...result, methods: mock.requests.map((r) => r.method) };
}

describe('1 — a secret straddling the 500-character detail cut', () => {
  it.each([
    ['the full URL', LONG_HOOK],
    ['the path alone', `/api/webhooks/99/${LONG_TOKEN}`],
  ])('redacts the cut-off start of %s', async (_, quoted) => {
    for (let cutInside = 8; cutInside < quoted.length; cutInside += 7) {
      const detail = `${'x'.repeat(500 - cutInside)}${quoted} trailing`;
      const alerts = alertsWith((a) => {
        a.alertRecipients[0].url = LONG_HOOK;
      });
      const mock = new MockGlitchTip()
        .json('GET', ALERTS_URL, alerts)
        .json('PUT', alertUrl(7), { detail }, { status: 422 });
      const { text, isError } = await call(mock, 'update_project_alert', {
        organization: 'acme',
        project: 'web',
        alert_id: 7,
        name: 'x',
      });
      expect(isError).toBe(true);
      expect(text, `cut ${cutInside}`).not.toContain(LONG_TOKEN.slice(0, 4));
      expect(text, `cut ${cutInside}`).not.toContain('webhooks/99');
      expect(text.endsWith(`${REDACTED}…`), `cut ${cutInside}`).toBe(true);
    }
  });

  it('scrub() redacts a trailing start of a secret of at least 6 characters, with or without …', () => {
    const secrets = secretsFrom([LONG_HOOK], []);
    expect(scrub('see https://discord.com/api/webh…', secrets)).toBe(`see ${REDACTED}…`);
    expect(scrub('see /api/webhooks/99/ABC', secrets)).toBe(`see ${REDACTED}`);
    expect(scrub('ends in /api', secrets)).toBe('ends in /api');
  });
});

describe('2 — a missing or null recipient list never becomes PUT []', () => {
  it.each([
    ['null', null],
    ['missing', undefined],
  ])('update_project_alert refuses when alertRecipients is %s', async (_, value) => {
    const alerts = alertsWith((a) => {
      (a as { alertRecipients?: unknown }).alertRecipients = value;
    });
    const { text, isError, methods } = await update(alerts);
    expect(isError).toBe(true);
    expect(text).toContain('GlitchTip returned no list of recipients');
    expect(methods).toEqual(['GET']);
  });

  it('add_alert_recipient does not PUT only the new recipient', async () => {
    const alerts = alertsWith((a) => {
      (a as { alertRecipients?: unknown }).alertRecipients = null;
    });
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, alerts);
    const { isError } = await call(mock, 'add_alert_recipient', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      recipient: { type: 'email' },
    });
    expect(isError).toBe(true);
    expect(mock.requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('remove_alert_recipient does not PUT when the list is null', async () => {
    const alerts = alertsWith((a) => {
      (a as { alertRecipients?: unknown }).alertRecipients = null;
    });
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, alerts);
    const { isError } = await call(mock, 'remove_alert_recipient', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      recipient_id: 31,
      confirm: '31',
    });
    expect(isError).toBe(true);
    expect(mock.requests.map((r) => r.method)).toEqual(['GET']);
  });
});

describe('3 — missing scalars are refused, not defaulted', () => {
  it.each(['uptime', 'timespanMinutes', 'quantity', 'name'] as const)(
    'refuses before the PUT when %s is missing',
    async (field) => {
      const alerts = alertsWith((a) => {
        delete (a as Partial<Alert>)[field];
      });
      const { text, isError, methods } = await update(alerts);
      expect(isError).toBe(true);
      expect(text).toContain('cannot be re-sent unchanged');
      expect(methods).toEqual(['GET']);
    },
  );

  it('refuses a non-boolean uptime', async () => {
    const { isError, methods } = await update(
      alertsWith((a) => {
        (a as { uptime: unknown }).uptime = 'false';
      }),
    );
    expect(isError).toBe(true);
    expect(methods).toEqual(['GET']);
  });
});

describe('4, 5 — URL forms in the scrub list', () => {
  it('keeps a short ntfy path, whatever its length', () => {
    const secrets = secretsFrom(['https://ntfy.sh/s3cr3t'], []);
    expect(scrub('POST /s3cr3t failed', secrets)).toBe(`POST ${REDACTED} failed`);
  });

  it('never scrubs a bare /', () => {
    expect(secretsFrom(['https://hooks.example.test/'], [])).not.toContain('/');
  });

  it('covers decoded, raw-as-stored, last-segment and JSON-escaped forms', () => {
    const url = 'https://hooks.example.test/a/b%20c/LAST_SEGMENT_TOKEN?k=v%21';
    const secrets = secretsFrom([url], ['key"with\\quote']);
    expect(scrub('decoded /a/b c/LAST_SEGMENT_TOKEN?k=v!', secrets)).toBe(`decoded ${REDACTED}`);
    expect(scrub('segment LAST_SEGMENT_TOKEN only', secrets)).toBe(`segment ${REDACTED} only`);
    expect(scrub('json "key\\"with\\\\quote"', secrets)).toBe(`json "${REDACTED}"`);
    const unnormalised = 'https://hooks.example.test/x/../RAW_PATH_SECRET_1';
    expect(scrub('raw /x/../RAW_PATH_SECRET_1', secretsFrom([unnormalised], []))).toBe(
      `raw ${REDACTED}`,
    );
  });

  it('still floors keys at 8 characters', () => {
    expect(secretsFrom([], ['short'])).toEqual([]);
  });
});

describe('6 — ids and counts render only when numeric', () => {
  it('renders ? for a string id, quantity and timespan', async () => {
    const alerts = alertsWith((a) => {
      Object.assign(a, { id: 7, quantity: '10 [inject]', timespanMinutes: { x: 1 } });
      Object.assign(a.alertRecipients[0], { id: '31 IGNORE' });
    });
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, alerts);
    const { text, isError } = await call(mock, 'list_project_alerts', {
      organization: 'acme',
      project: 'web',
    });
    expect(isError).toBe(false);
    expect(text).toContain('trigger: ? events in ? minutes');
    expect(text).toContain('recipient ?  discord');
    expect(text).not.toContain('inject');
    expect(text).not.toContain('IGNORE');
  });
});

describe('7, 9 — the stored Zulip config', () => {
  it('re-sends a null topic as GlitchTip’s default', async () => {
    const alerts = alertsWith((a) => {
      (a.alertRecipients[1].config as Record<string, unknown>).topic = null;
    });
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, alerts).json('PUT', alertUrl(7), {});
    await call(mock, 'update_project_alert', {
      organization: 'acme',
      project: 'web',
      alert_id: 7,
      name: 'x',
    });
    const body = JSON.parse(mock.requests[1].body) as { alertRecipients: { topic?: string }[] };
    expect(body.alertRecipients[1].topic).toBe('GlitchTip Alerts');
  });

  it.each([
    ['a non-string topic', { topic: 42 }, 'its Zulip topic is not a string'],
    ['an unknown config key', { stream_id: 5 }, 'hold a key this server cannot re-send'],
  ])('refuses %s before the PUT', async (_, extra, message) => {
    const alerts = alertsWith((a) => {
      Object.assign(a.alertRecipients[1].config as Record<string, unknown>, extra);
    });
    const { text, isError, methods } = await update(alerts);
    expect(isError).toBe(true);
    expect(text).toContain(message);
    expect(methods).toEqual(['GET']);
    expectNoSecrets(text);
  });
});
