import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 11: format: "json" stays valid JSON for every read tool, including over
// MCP_RESPONSE_BUDGET; list_monitors' fence declares source="glitchtip-config".

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function call(
  mock: MockGlitchTip,
  name: string,
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv = {},
) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'monitors', ...env },
    mock,
  );
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

function unfence(text: string): string {
  return text.replace(/^<untrusted[^>]*>/, '').replace(/<\/untrusted>$/, '');
}

describe('list_monitors json over budget', () => {
  it('stays valid, parseable JSON, fenced as glitchtip-config', async () => {
    const monitors = Array.from({ length: 300 }, (_, i) => ({
      id: i,
      name: `Monitor ${i} — a fairly long name to help exceed the budget`.repeat(3),
      monitorType: 'GET',
      isUp: true,
      lastChange: '2026-01-01T00:00:00Z',
      url: 'https://api.example.test/health',
      expectedStatus: 200,
      expectedBody: '',
      interval: 60,
      timeout: null,
      confirmationThreshold: 1,
      projectID: null,
      organizationID: 1,
      heartbeatEndpoint: null,
      created: '2026-01-01T00:00:00Z',
      checks: [],
    }));
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/`, monitors);
    const { text, isError } = await call(
      mock,
      'list_monitors',
      { organization: 'acme', format: 'json' },
      { MCP_RESPONSE_BUDGET: '2000' },
    );
    expect(isError).toBe(false);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toMatch(/^<untrusted source="glitchtip-config" field="monitors">/);
    const parsed = JSON.parse(unfence(text));
    expect(parsed).toHaveProperty('monitors');
  });
});

describe('get_monitor json over budget', () => {
  it('stays valid, parseable JSON, fenced as glitchtip-config field=monitor', async () => {
    const monitor = {
      id: 1,
      name: 'Monitor',
      monitorType: 'GET',
      isUp: true,
      lastChange: '2026-01-01T00:00:00Z',
      url: 'https://api.example.test/health',
      expectedStatus: 200,
      expectedBody: 'x'.repeat(2000),
      interval: 60,
      timeout: null,
      confirmationThreshold: 1,
      projectID: null,
      organizationID: 1,
      heartbeatEndpoint: null,
      created: '2026-01-01T00:00:00Z',
      checks: Array.from({ length: 60 }, (_, i) => ({
        startCheck: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
        isUp: true,
        reason: 0,
        responseTime: 100,
      })),
    };
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/1/`, monitor);
    const { text, isError } = await call(
      mock,
      'get_monitor',
      { organization: 'acme', monitor_id: 1, format: 'json' },
      { MCP_RESPONSE_BUDGET: '1000' },
    );
    expect(isError).toBe(false);
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(text).toMatch(/^<untrusted source="glitchtip-config" field="monitor">/);
    expect(() => JSON.parse(unfence(text))).not.toThrow();
  });
});

describe('list_monitor_checks json', () => {
  it('stays valid, parseable JSON with no untrusted fence', async () => {
    const checks = Array.from({ length: 60 }, (_, i) => ({
      startCheck: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
      isUp: true,
      reason: 0,
      responseTime: 100,
    }));
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/monitors/1/checks/`,
      checks,
    );
    const { text, isError } = await call(mock, 'list_monitor_checks', {
      organization: 'acme',
      monitor_id: 1,
      limit: 60,
      format: 'json',
    });
    expect(isError).toBe(false);
    expect(text).not.toContain('<untrusted');
    const parsed = JSON.parse(text);
    expect(parsed.checks).toHaveLength(60);
  });
});
