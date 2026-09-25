import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 3, 6, 7, 12: get_organization_stats against a mocked GlitchTip (method, path,
// query — always interval=1h and field=sum(quantity)), its error path, now-<n> resolution,
// the 41-day range limit, and json validity/no fencing.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function boot(mock: MockGlitchTip, env: NodeJS.ProcessEnv = {}) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'stats', GLITCHTIP_READ_ONLY: 'false', ...env },
    mock,
  );
  return booted.client;
}

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>, env = {}) {
  const client = await boot(mock, env);
  const result = await client.callTool({ name, arguments: args });
  return { result, text: resultText(result), isError: result.isError === true };
}

const STATS_RESPONSE = {
  intervals: ['2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'],
  groups: [{ series: { 'sum(quantity)': [3, 9] } }],
};

describe('get_organization_stats', () => {
  it('always sends interval=1h and field=sum(quantity) (acceptance 7)', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/stats_v2/`,
      STATS_RESPONSE,
    );
    await call(mock, 'get_organization_stats', {
      organization: 'acme',
      category: 'error',
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-01T01:00:00Z',
    });
    const params = mock.requests[0].url.searchParams;
    expect(params.get('interval')).toBe('1h');
    expect(params.get('field')).toBe('sum(quantity)');
    expect(params.get('category')).toBe('error');
  });

  it('renders total and the peak bucket', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/stats_v2/`,
      STATS_RESPONSE,
    );
    const { text } = await call(mock, 'get_organization_stats', {
      organization: 'acme',
      category: 'transaction',
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-01T02:00:00Z',
    });
    expect(text).toContain('total: 12');
    expect(text).toContain('peak: 2026-01-01T01:00:00Z (9)');
  });

  it('resolves now-24h to an ISO date-time before sending (acceptance 6)', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/stats_v2/`,
      STATS_RESPONSE,
    );
    await call(mock, 'get_organization_stats', {
      organization: 'acme',
      category: 'error',
      start: 'now-24h',
      end: 'now',
    });
    const sent = mock.requests[0].url.searchParams.get('start');
    expect(sent).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('rejects a range beyond 41 days before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError, text } = await call(mock, 'get_organization_stats', {
      organization: 'acme',
      category: 'error',
      start: '2026-01-01T00:00:00Z',
      end: '2026-03-01T00:00:00Z',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('rejects start not before end before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError } = await call(mock, 'get_organization_stats', {
      organization: 'acme',
      category: 'error',
      start: '2026-01-02T00:00:00Z',
      end: '2026-01-01T00:00:00Z',
    });
    expect(isError).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });

  it('maps 404 to the enhanced message', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/stats_v2/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'get_organization_stats', {
      organization: 'acme',
      category: 'error',
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-01T01:00:00Z',
    });
    expect(isError).toBe(true);
    expect(text).toBe(
      'No projects matched in acme: the organization does not exist for this token, has no ' +
        'projects, or none of `project_ids` belongs to it.',
    );
  });

  it('turns a 403 into an actionable tool error naming org scopes', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/stats_v2/`,
      {},
      { status: 403 },
    );
    const { text } = await call(mock, 'get_organization_stats', {
      organization: 'acme',
      category: 'error',
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-01T01:00:00Z',
    });
    expect(text).toBe(
      'The token lacks permission for get organization stats. It needs one of: org:read, org:write, org:admin.',
    );
  });

  it('returns valid JSON, not fenced (acceptance 12)', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/stats_v2/`,
      STATS_RESPONSE,
    );
    const { text } = await call(mock, 'get_organization_stats', {
      organization: 'acme',
      category: 'error',
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-01T01:00:00Z',
      format: 'json',
    });
    expect(text).not.toContain('<untrusted');
    expect(() => JSON.parse(text)).not.toThrow();
  });
});
