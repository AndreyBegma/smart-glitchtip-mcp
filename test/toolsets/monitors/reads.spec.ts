import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 2, 3, 9: list_monitors, get_monitor, list_monitor_checks — method/path/query
// assertions, the untrusted-fenced fields, heartbeat masking, error paths.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

const MONITOR = {
  id: 1,
  name: 'API health',
  monitorType: 'GET',
  isUp: true,
  lastChange: '2026-01-01T00:00:00Z',
  url: 'https://api.example.test/health',
  expectedStatus: 200,
  expectedBody: '',
  interval: 60,
  timeout: null,
  confirmationThreshold: 1,
  projectID: '9',
  projectName: 'web',
  envName: 'production',
  organizationID: 42,
  endpointID: null,
  heartbeatEndpoint: null,
  created: '2025-12-01T00:00:00Z',
  checks: [
    { startCheck: '2026-01-01T00:05:00Z', isUp: true, reason: 0, responseTime: 120 },
    { startCheck: '2026-01-01T00:04:00Z', isUp: true, reason: 0, responseTime: 100 },
    { startCheck: '2026-01-01T00:03:00Z', isUp: false, reason: 2, responseTime: 80 },
  ],
};

const HEARTBEAT_MONITOR = {
  ...MONITOR,
  id: 2,
  name: 'Nightly cron ping',
  monitorType: 'Heartbeat',
  url: null,
  endpointID: '3f2c1234567890abcdef1234567890a1b2',
  heartbeatEndpoint:
    'https://glitchtip.test/api/0/organizations/acme/heartbeat_check/3f2c1234567890abcdef1234567890a1b2/',
  checks: [],
};

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function boot(mock: MockGlitchTip, env: NodeJS.ProcessEnv = {}) {
  booted = await bootInMemory(
    {
      GLITCHTIP_TOKEN: TOKEN,
      GLITCHTIP_TOOLSETS: 'monitors',
      GLITCHTIP_READ_ONLY: 'false',
      ...env,
    },
    mock,
  );
  return booted.client;
}

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>, env = {}) {
  const client = await boot(mock, env);
  const result = await client.callTool({ name, arguments: args });
  return { result, text: resultText(result), isError: result.isError === true };
}

describe('list_monitors', () => {
  it('renders a table with state, lastChange, uptime, and sends limit/cursor', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/`, [MONITOR], {
      headers: {
        link: `<${API}/organizations/acme/monitors/?cursor=n>; rel="next"; results="true"; cursor="0:2:0"`,
      },
    });
    const { text } = await call(mock, 'list_monitors', {
      organization: 'acme',
      limit: 10,
      cursor: 'c0',
    });
    expect(text).toContain('1');
    expect(text).toContain('GET');
    expect(text).toContain('up');
    expect(text).toContain('up 2/3');
    expect(text).toContain(
      '<untrusted source="glitchtip-config" field="name">API health</untrusted>',
    );
    expect(text).toContain('https://api.example.test/health');
    expect(text).toContain('next cursor: 0:2:0');
    expect(mock.requests[0].url.searchParams.get('limit')).toBe('10');
    expect(mock.requests[0].url.searchParams.get('cursor')).toBe('c0');
  });

  it('shows "—" for a Heartbeat monitor\'s url and no heartbeat info at all', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/`, [
      HEARTBEAT_MONITOR,
    ]);
    const { text } = await call(mock, 'list_monitors', { organization: 'acme' });
    expect(text).toContain('—');
    expect(text).not.toContain('heartbeat');
    expect(text).not.toContain(HEARTBEAT_MONITOR.endpointID);
  });

  it('renders isUp: null as pending, not down', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/`, [
      { ...MONITOR, isUp: null, checks: [] },
    ]);
    const { text } = await call(mock, 'list_monitors', { organization: 'acme' });
    expect(text).toContain('pending');
    expect(text).not.toContain('down');
  });

  it('says so when there are no monitors, without isError', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/`, []);
    const { text, isError } = await call(mock, 'list_monitors', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).toBe('No monitors in acme.');
  });

  it('returns projected json fenced as glitchtip-config', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/`, [MONITOR]);
    const { text } = await call(mock, 'list_monitors', { organization: 'acme', format: 'json' });
    expect(text).toMatch(/^<untrusted source="glitchtip-config" field="monitors">/);
    const parsed = JSON.parse(text.replace(/^<untrusted[^>]*>/, '').replace(/<\/untrusted>$/, ''));
    expect(parsed.monitors[0]).toMatchObject({ id: 1, name: 'API health', state: 'up' });
  });

  it('maps 404 to the instance-disabled hint only (no monitor id to name)', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/monitors/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'list_monitors', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toBe(
      'If no monitor path works at all, uptime monitoring may be disabled on this instance ' +
        '(GLITCHTIP_ENABLE_UPTIME).',
    );
  });

  it('is malformed, not an empty list, when GlitchTip answers with an object', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/`, {
      results: [],
    });
    const { text, isError } = await call(mock, 'list_monitors', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toMatch(/^GlitchTip answered list monitors with something other than a list/);
  });
});

describe('get_monitor', () => {
  it('shows state, url, thresholds and a check summary', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/1/`, MONITOR);
    const { text } = await call(mock, 'get_monitor', { organization: 'acme', monitor_id: 1 });
    expect(text).toContain('state: up');
    expect(text).toContain('interval: 60s');
    expect(text).toContain('timeout: default (20 s)');
    expect(text).toContain('confirmationThreshold: 1');
    expect(text).toContain('environment: production');
    expect(text).toContain('last check: 2026-01-01T00:05:00Z up (unknown)');
    expect(text).toContain('response time: avg 100 ms, max 120 ms');
    expect(text).toContain('last state changes:');
    expect(text).toContain('Full history: list_monitor_checks(monitor_id).');
    expect(mock.requests[0].url.pathname).toBe('/api/0/organizations/acme/monitors/1/');
  });

  it('masks the heartbeat id by default, showing neither the full id nor the url', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/monitors/2/`,
      HEARTBEAT_MONITOR,
    );
    const { text } = await call(mock, 'get_monitor', { organization: 'acme', monitor_id: 2 });
    expect(text).toContain('heartbeat endpoint: configured (id …a1b2)');
    expect(text).not.toContain(HEARTBEAT_MONITOR.endpointID);
    expect(text).not.toContain(HEARTBEAT_MONITOR.heartbeatEndpoint);
  });

  it('shows the full heartbeat id and url with include_heartbeat_url, and the warning sentence', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/monitors/2/`,
      HEARTBEAT_MONITOR,
    );
    const { text } = await call(mock, 'get_monitor', {
      organization: 'acme',
      monitor_id: 2,
      include_heartbeat_url: true,
    });
    expect(text).toContain(`heartbeat endpoint: configured (id ${HEARTBEAT_MONITOR.endpointID})`);
    expect(text).toContain(
      "This URL lets anyone mark the monitor as up; put it only into the monitored service's configuration.",
    );
    expect(text).toContain(HEARTBEAT_MONITOR.heartbeatEndpoint);
  });

  it('returns projected json', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/1/`, MONITOR);
    const { text } = await call(mock, 'get_monitor', {
      organization: 'acme',
      monitor_id: 1,
      format: 'json',
    });
    const parsed = JSON.parse(text.replace(/^<untrusted[^>]*>/, '').replace(/<\/untrusted>$/, ''));
    expect(parsed).toMatchObject({
      id: 1,
      name: 'API health',
      state: 'up',
      environment: 'production',
    });
    expect(parsed.avgResponseTimeMs).toBe(100);
    expect(parsed.maxResponseTimeMs).toBe(120);
  });

  it('maps 404 to a message naming the monitor', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/monitors/9/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'get_monitor', {
      organization: 'acme',
      monitor_id: 9,
    });
    expect(isError).toBe(true);
    expect(text).toBe(
      'Monitor 9 was not found in acme. If no monitor path works at all, uptime monitoring may be ' +
        'disabled on this instance (GLITCHTIP_ENABLE_UPTIME).',
    );
  });

  it('refuses a non-positive monitor_id before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError, text } = await call(mock, 'get_monitor', {
      organization: 'acme',
      monitor_id: -1,
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });
});

describe('list_monitor_checks', () => {
  it('sends limit/cursor and omits is_change when changes_only is not given', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/monitors/1/checks/`,
      MONITOR.checks,
    );
    const { text } = await call(mock, 'list_monitor_checks', {
      organization: 'acme',
      monitor_id: 1,
      limit: 10,
    });
    expect(text).toContain('up');
    expect(text).toContain('down');
    expect(text).toContain('wrong status code');
    expect(text).toContain('120');
    expect(mock.requests[0].url.searchParams.has('is_change')).toBe(false);
  });

  it('sends is_change=true when changes_only is true', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/monitors/1/checks/`,
      [],
    );
    await call(mock, 'list_monitor_checks', {
      organization: 'acme',
      monitor_id: 1,
      changes_only: true,
    });
    expect(mock.requests[0].url.searchParams.get('is_change')).toBe('true');
  });

  it('says so when there are no checks', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/monitors/1/checks/`,
      [],
    );
    const { text } = await call(mock, 'list_monitor_checks', {
      organization: 'acme',
      monitor_id: 1,
    });
    expect(text).toBe('No checks recorded for monitor 1.');
  });

  it('says so for changes_only when there are no state changes', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/monitors/1/checks/`,
      [],
    );
    const { text } = await call(mock, 'list_monitor_checks', {
      organization: 'acme',
      monitor_id: 1,
      changes_only: true,
    });
    expect(text).toBe('No state changes recorded for monitor 1.');
  });

  it('returns projected json with no untrusted fence', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/monitors/1/checks/`,
      MONITOR.checks,
    );
    const { text } = await call(mock, 'list_monitor_checks', {
      organization: 'acme',
      monitor_id: 1,
      format: 'json',
    });
    expect(text).not.toContain('<untrusted');
    expect(JSON.parse(text).checks).toHaveLength(3);
  });
});
