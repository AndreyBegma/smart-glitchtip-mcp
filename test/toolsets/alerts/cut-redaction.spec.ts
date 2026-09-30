import { describe, expect, it, vi } from 'vitest';
import { MockGlitchTip } from '../../support/mock-glitchtip';
import { ALERTS_URL, call, WEBHOOK_SECRET, WEBHOOK_URL } from './alerts.support';

// BUG-20260925-018 acceptance 4: the alerts toolset now passes its webhook/Zulip secret
// forms to the client as `extraSecrets` (BUG-20260925-017), so a secret straddling
// GlitchTip's 500-character detail cut is redacted at the foundation before this toolset's
// own local scrub (`alerts.secrets.ts`) ever sees the text. Proved here with that local
// scrub replaced by a no-op, so only the client-level fix can be doing the work.

vi.mock('../../../src/toolsets/alerts/alerts.secrets', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/toolsets/alerts/alerts.secrets')>();
  return { ...actual, scrub: (text: string) => text };
});

const DETAIL_LIMIT = 500;
const SHORTEST_LEAK = 4;

/** The longest start of `secret` (4+ characters) found anywhere in `text`. */
function leakedStart(text: string, secret: string): string | undefined {
  for (let length = secret.length; length >= SHORTEST_LEAK; length--) {
    const start = secret.slice(0, length);
    if (text.includes(start)) return start;
  }
  return undefined;
}

/** A detail longer than the cut, with the webhook URL straddling it. */
function straddlingDetail(): string {
  const offset = Math.min(480, DETAIL_LIMIT - WEBHOOK_URL.length);
  return `${'x'.repeat(offset)}${WEBHOOK_URL}${'y'.repeat(DETAIL_LIMIT)}`;
}

describe('alerts: extraSecrets covers the detail cut even with the local scrub disabled', () => {
  it('create_project_alert: no prefix of the webhook URL survives the cut', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      ALERTS_URL,
      { detail: straddlingDetail() },
      { status: 422 },
    );
    const { text, isError } = await call(mock, 'create_project_alert', {
      organization: 'acme',
      project: 'web',
      recipients: [{ type: 'discord', url: WEBHOOK_URL }],
    });
    expect(isError).toBe(true);
    expect(leakedStart(text, WEBHOOK_URL)).toBeUndefined();
    expect(leakedStart(text, WEBHOOK_SECRET)).toBeUndefined();
  });
});
