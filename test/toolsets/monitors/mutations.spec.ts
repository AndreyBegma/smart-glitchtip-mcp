import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { jsonResponse, MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 4, 5, 6, 9: create_monitor's type-rule validation and project resolution,
// update_monitor's GET-then-PUT full-replace merge, delete_monitor's confirm guard, heartbeat
// masking on write responses.

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

describe('create_monitor', () => {
  it('sends the full MonitorIn body for a Ping monitor', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/monitors/`,
      jsonResponse({ ...MONITOR, monitorType: 'Ping' }, 201),
    );
    await call(mock, 'create_monitor', {
      organization: 'acme',
      name: 'Ping check',
      monitor_type: 'Ping',
      url: '1.2.3.4',
    });
    expect(JSON.parse(mock.requests[0].body)).toEqual({
      name: 'Ping check',
      monitorType: 'Ping',
      url: '1.2.3.4',
      expectedStatus: null,
      expectedBody: '',
      interval: 60,
      timeout: null,
      confirmationThreshold: 1,
    });
  });

  it('creates a Heartbeat monitor with no url', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/monitors/`,
      jsonResponse({ ...MONITOR, monitorType: 'Heartbeat', url: null }, 201),
    );
    const { isError } = await call(mock, 'create_monitor', {
      organization: 'acme',
      name: 'Cron',
      monitor_type: 'Heartbeat',
    });
    expect(isError).toBe(false);
    const body = JSON.parse(mock.requests[0].body);
    expect(body).not.toHaveProperty('url');
  });

  it('refuses a GET monitor without expected_status before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError, text } = await call(mock, 'create_monitor', {
      organization: 'acme',
      name: 'API',
      monitor_type: 'GET',
      url: 'https://api.example.test/',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('refuses an SSL monitor without a url before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'create_monitor', {
      organization: 'acme',
      name: 'API',
      monitor_type: 'SSL',
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });

  it('resolves a project slug to its id and sends it in the body', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/projects/acme/web/`, { id: '9', slug: 'web', name: 'Web' })
      .on('POST', `${API}/organizations/acme/monitors/`, jsonResponse(MONITOR, 201));
    await call(mock, 'create_monitor', {
      organization: 'acme',
      name: 'API health',
      monitor_type: 'GET',
      url: 'https://api.example.test/health',
      expected_status: 200,
      project: 'web',
    });
    expect(mock.requests.map((r) => r.method)).toEqual(['GET', 'POST']);
    expect(JSON.parse(mock.requests[1].body)).toMatchObject({ project: '9' });
  });

  it('surfaces a missing project as a 404 tool error', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/gone/`, {}, { status: 404 });
    const { isError, text } = await call(mock, 'create_monitor', {
      organization: 'acme',
      name: 'API health',
      monitor_type: 'GET',
      url: 'https://api.example.test/health',
      expected_status: 200,
      project: 'gone',
    });
    expect(isError).toBe(true);
    expect(text).toBe('Project gone was not found in acme.');
  });
});

describe('update_monitor', () => {
  it('with only name changed: GET then PUT, every other field re-sent unchanged', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/monitors/1/`, MONITOR)
      .json('PUT', `${API}/organizations/acme/monitors/1/`, { ...MONITOR, name: 'API health v2' });
    await call(mock, 'update_monitor', {
      organization: 'acme',
      monitor_id: 1,
      name: 'API health v2',
    });
    expect(mock.requests.map((r) => r.method)).toEqual(['GET', 'PUT']);
    expect(JSON.parse(mock.requests[1].body)).toEqual({
      name: 'API health v2',
      monitorType: 'GET',
      url: 'https://api.example.test/health',
      expectedStatus: 200,
      expectedBody: '',
      interval: 60,
      timeout: null,
      confirmationThreshold: 1,
      project: '9',
    });
  });

  it('re-sends a null expectedBody as ""', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/monitors/1/`, { ...MONITOR, expectedBody: null })
      .json('PUT', `${API}/organizations/acme/monitors/1/`, MONITOR);
    await call(mock, 'update_monitor', { organization: 'acme', monitor_id: 1, name: 'renamed' });
    const body = JSON.parse(mock.requests[1].body);
    expect(body).toHaveProperty('expectedBody', '');
  });

  it('sends project: null when the caller passes project: null', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/monitors/1/`, MONITOR)
      .json('PUT', `${API}/organizations/acme/monitors/1/`, { ...MONITOR, projectID: null });
    await call(mock, 'update_monitor', { organization: 'acme', monitor_id: 1, project: null });
    const body = JSON.parse(mock.requests[1].body);
    expect(body).toHaveProperty('project', null);
  });

  it('resolves a new project slug to its id', async () => {
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/monitors/1/`, MONITOR)
      .json('GET', `${API}/projects/acme/api/`, { id: '11', slug: 'api', name: 'API' })
      .json('PUT', `${API}/organizations/acme/monitors/1/`, MONITOR);
    await call(mock, 'update_monitor', { organization: 'acme', monitor_id: 1, project: 'api' });
    expect(mock.requests.map((r) => r.method)).toEqual(['GET', 'GET', 'PUT']);
    const body = JSON.parse(mock.requests[2].body);
    expect(body).toHaveProperty('project', '11');
  });

  it('refuses when no field is given', async () => {
    const mock = new MockGlitchTip();
    const { isError, text } = await call(mock, 'update_monitor', {
      organization: 'acme',
      monitor_id: 1,
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('refuses without a PUT when switching to GET and the current monitor has no expected_status', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/1/`, {
      ...MONITOR,
      monitorType: 'Ping',
      expectedStatus: null,
    });
    const { isError, text } = await call(mock, 'update_monitor', {
      organization: 'acme',
      monitor_id: 1,
      monitor_type: 'GET',
    });
    expect(isError).toBe(true);
    expect(text).toContain('expected_status');
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe('GET');
  });

  it('always masks the heartbeat line in its output', async () => {
    const heartbeat = {
      ...MONITOR,
      monitorType: 'Heartbeat',
      url: null,
      endpointID: '3f2c1234567890abcdef1234567890a1b2',
      heartbeatEndpoint:
        'https://glitchtip.test/api/0/organizations/acme/heartbeat_check/3f2c1234567890abcdef1234567890a1b2/',
    };
    const mock = new MockGlitchTip()
      .json('GET', `${API}/organizations/acme/monitors/1/`, heartbeat)
      .json('PUT', `${API}/organizations/acme/monitors/1/`, heartbeat);
    const { text } = await call(mock, 'update_monitor', {
      organization: 'acme',
      monitor_id: 1,
      name: 'renamed',
    });
    expect(text).toContain('…a1b2');
    expect(text).not.toContain(heartbeat.endpointID);
    expect(text).not.toContain(heartbeat.heartbeatEndpoint);
  });
});

describe('delete_monitor', () => {
  it('deletes when confirm matches the monitor id', async () => {
    const mock = new MockGlitchTip().on(
      'DELETE',
      `${API}/organizations/acme/monitors/1/`,
      new Response(null, { status: 204 }),
    );
    const { text, isError } = await call(mock, 'delete_monitor', {
      organization: 'acme',
      monitor_id: 1,
      confirm: '1',
    });
    expect(isError).toBe(false);
    expect(text).toBe('Deleted monitor 1.');
  });

  it('refuses when confirm does not match, without calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'delete_monitor', {
      organization: 'acme',
      monitor_id: 1,
      confirm: '2',
    });
    expect(isError).toBe(true);
    expect(text).toContain('confirm must equal the monitor id "1"');
    expect(mock.requests).toHaveLength(0);
  });

  it('refuses when confirm is missing, without calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'delete_monitor', {
      organization: 'acme',
      monitor_id: 1,
      confirm: '',
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });
});
