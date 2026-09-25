import { afterEach, describe, expect, it } from 'vitest';
import malformedCheck from '../../fixtures/monitors/malformed-check.json';
import malformedMonitor from '../../fixtures/monitors/malformed-monitor.json';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 10: a malformed/partial GlitchTip response degrades the text output instead of
// throwing (never "Internal error"); a field of the wrong type is the `malformed` tool error.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';
const MALFORMED = /^GlitchTip returned a response this server did not expect for/;

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>) {
  booted = await bootInMemory({ GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'monitors' }, mock);
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

describe('list_monitors', () => {
  it('renders a monitor missing checks, timeout and project without throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/`, [
      malformedMonitor,
    ]);
    const { text, isError } = await call(mock, 'list_monitors', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).toContain('API health');
    expect(text).toContain('no checks yet');
    expect(text).not.toContain('Internal error');
  });

  it('is a malformed tool error naming list_monitors when checks is not an array', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/`, [
      { ...malformedMonitor, checks: 123 },
    ]);
    const { text, isError } = await call(mock, 'list_monitors', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('list_monitors');
    expect(text).not.toContain('Internal error');
  });
});

describe('get_monitor', () => {
  it('renders a monitor missing checks, timeout and project without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/monitors/1/`,
      malformedMonitor,
    );
    const { text, isError } = await call(mock, 'get_monitor', {
      organization: 'acme',
      monitor_id: 1,
    });
    expect(isError).toBe(false);
    expect(text).toContain('checks: unavailable');
    expect(text).toContain('timeout: default (20 s)');
    expect(text).not.toContain('Internal error');
  });

  it('is a malformed tool error naming get_monitor when checks is not an array', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/1/`, {
      ...malformedMonitor,
      checks: 123,
    });
    const { text, isError } = await call(mock, 'get_monitor', {
      organization: 'acme',
      monitor_id: 1,
    });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('get_monitor');
    expect(text).not.toContain('Internal error');
  });
});

describe('list_monitor_checks', () => {
  it('renders a check missing reason and responseTime without throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/1/checks/`, [
      malformedCheck,
    ]);
    const { text, isError } = await call(mock, 'list_monitor_checks', {
      organization: 'acme',
      monitor_id: 1,
    });
    expect(isError).toBe(false);
    expect(text).toContain('up');
    expect(text).not.toContain('Internal error');
  });

  it('is malformed, not an empty list, when GlitchTip answers with an object', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/monitors/1/checks/`, {
      results: [],
    });
    const { text, isError } = await call(mock, 'list_monitor_checks', {
      organization: 'acme',
      monitor_id: 1,
    });
    expect(isError).toBe(true);
    expect(text).toMatch(
      /^GlitchTip answered list monitor checks with something other than a list/,
    );
  });
});
