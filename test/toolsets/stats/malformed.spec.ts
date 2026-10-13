import { afterEach, describe, expect, it } from 'vitest';
import malformedStats from '../../fixtures/stats/malformed-stats.json';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 11: a partial/degraded GlitchTip response (series shorter than intervals)
// renders a text result with the gap marked, never "Internal error"; a structural break
// (intervals not an array) is the `malformed` tool error naming the tool.

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
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'stats', GLITCHTIP_READ_ONLY: 'false' },
    mock,
  );
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

describe('get_organization_stats — degraded', () => {
  it('renders a series shorter than intervals without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/stats_v2/`,
      malformedStats,
    );
    const { text, isError } = await call(mock, 'get_organization_stats', {
      organization: 'acme',
      category: 'error',
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-01T02:00:00Z',
    });
    expect(isError).toBe(false);
    expect(text).not.toContain('Internal error');
    expect(text).toContain('total:');
  });
});

describe('get_organization_stats — structural break', () => {
  it('is a malformed tool error when intervals is not a list', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/stats_v2/`, {
      intervals: 'oops',
      groups: [],
    });
    const { text, isError } = await call(mock, 'get_organization_stats', {
      organization: 'acme',
      category: 'error',
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-01T02:00:00Z',
    });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('get_organization_stats');
    expect(text).not.toContain('Internal error');
  });
});
