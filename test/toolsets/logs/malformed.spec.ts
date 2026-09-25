import { afterEach, describe, expect, it } from 'vitest';
import malformedLog from '../../fixtures/logs/malformed-log.json';
import malformedLogResource from '../../fixtures/logs/malformed-log-resource.json';
import malformedLogStats from '../../fixtures/logs/malformed-log-stats.json';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 11: a partial/degraded GlitchTip response renders a text result with the gap
// marked, never "Internal error"; a structural break (wrong field type) is the `malformed`
// tool error naming the tool.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';
const MALFORMED = /^GlitchTip returned a response this server did not expect for/;

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'logs', GLITCHTIP_READ_ONLY: 'false' },
    mock,
  );
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

describe('list_logs — degraded', () => {
  it('renders a log with null service/environment/host without throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/logs/`, [malformedLog]);
    const { text, isError } = await call(mock, 'list_logs', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).not.toContain('Internal error');
    expect(text).toContain('started');
  });
});

describe('list_logs — structural break', () => {
  it('is malformed, not an empty list, when GlitchTip answers with an object', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/logs/`, {
      results: [],
    });
    const { text, isError } = await call(mock, 'list_logs', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toMatch(/^GlitchTip answered list logs with something other than a list/);
  });
});

describe('get_log_stats — degraded', () => {
  it('renders a series shorter than intervals with the gap marked, not throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/logs/stats/`,
      malformedLogStats,
    );
    const { text, isError } = await call(mock, 'get_log_stats', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).not.toContain('Internal error');
    expect(text).toContain('lengths differ');
  });
});

describe('get_log_stats — structural break', () => {
  it('is a malformed tool error when series is not a list', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/logs/stats/`, {
      intervals: ['2026-01-01T00:00:00Z'],
      series: 'oops',
    });
    const { text, isError } = await call(mock, 'get_log_stats', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('get_log_stats');
  });
});

describe('list_log_resources — degraded', () => {
  it('renders a resource with a null lastSeen without throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/logs/resources/`, [
      malformedLogResource,
    ]);
    const { text, isError } = await call(mock, 'list_log_resources', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).not.toContain('Internal error');
    expect(text).toContain('checkout-api');
  });
});

describe('list_log_resources — structural break', () => {
  it('is a malformed tool error when the body is not a list', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/logs/resources/`, {
      oops: true,
    });
    const { text, isError } = await call(mock, 'list_log_resources', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('list_log_resources');
  });
});

describe('get_log — degraded', () => {
  it('renders a log with null service/environment/host without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/logs/018f2a3b-0000-7000-8000-000000000001/`,
      malformedLog,
    );
    const { text, isError } = await call(mock, 'get_log', {
      organization: 'acme',
      log_id: '018f2a3b-0000-7000-8000-000000000001',
    });
    expect(isError).toBe(false);
    expect(text).not.toContain('Internal error');
    expect(text).toContain('started');
  });
});

describe('get_log — structural break', () => {
  it('is a malformed tool error when the body is not an object', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/logs/018f2a3b-0000-7000-8000-000000000001/`,
      null,
    );
    const { text, isError } = await call(mock, 'get_log', {
      organization: 'acme',
      log_id: '018f2a3b-0000-7000-8000-000000000001',
    });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('get_log');
  });
});
