import { afterEach, describe, expect, it } from 'vitest';
import malformedStatusPage from '../../fixtures/status_pages/malformed-status-page.json';
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
  booted = await bootInMemory({ GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'status_pages' }, mock);
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

describe('list_status_pages', () => {
  it('renders a page missing monitors without throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/status-pages/`, [
      malformedStatusPage,
    ]);
    const { text, isError } = await call(mock, 'list_status_pages', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).toContain('Public status');
    expect(text).toContain('monitors: none');
    expect(text).not.toContain('Internal error');
  });

  it('is a malformed tool error naming list_status_pages when monitors is not an array', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/status-pages/`, [
      { ...malformedStatusPage, monitors: 123 },
    ]);
    const { text, isError } = await call(mock, 'list_status_pages', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('list_status_pages');
    expect(text).not.toContain('Internal error');
  });
});
