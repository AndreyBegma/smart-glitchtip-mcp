import { describe, expect, it } from 'vitest';
import { MockGlitchTip } from '../../support/mock-glitchtip';
import { ALERTS_URL, call, expectNoSecrets, fixtureAlerts, unfence } from './alerts.support';

// Acceptance 10 (last sentence): format "json" over MCP_RESPONSE_BUDGET stays valid JSON (parsed
// here) and is fenced with source="glitchtip-config"; the budget cut never exposes a secret.

describe('list_project_alerts json over budget', () => {
  it('stays valid, parseable JSON fenced as glitchtip-config', async () => {
    const [seven] = fixtureAlerts();
    const alerts = Array.from({ length: 100 }, (_, i) => ({ ...seven, id: 100 + i }));
    const mock = new MockGlitchTip().json('GET', ALERTS_URL, alerts);
    const { text, isError } = await call(
      mock,
      'list_project_alerts',
      { organization: 'acme', project: 'web', limit: 100, format: 'json' },
      { MCP_RESPONSE_BUDGET: '2000' },
    );
    expect(isError).toBe(false);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toMatch(/^<untrusted source="glitchtip-config" field="alerts">/);
    expect(() => unfence(text)).not.toThrow();
    expectNoSecrets(text);
  });
});
