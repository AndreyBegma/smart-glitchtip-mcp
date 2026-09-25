import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 11: format: "json" stays valid JSON for list_status_pages, including over
// MCP_RESPONSE_BUDGET, fenced as source="glitchtip-config".

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
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'status_pages', ...env },
    mock,
  );
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

function unfence(text: string): string {
  return text.replace(/^<untrusted[^>]*>/, '').replace(/<\/untrusted>$/, '');
}

describe('list_status_pages json over budget', () => {
  it('stays valid, parseable JSON, fenced as glitchtip-config', async () => {
    const pages = Array.from({ length: 300 }, (_, i) => ({
      name: `Status page ${i} — a fairly long name to help exceed the budget`.repeat(3),
      isPublic: false,
      slug: `status-${i}`,
      monitors: [],
    }));
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/status-pages/`, pages);
    const { text, isError } = await call(
      mock,
      'list_status_pages',
      { organization: 'acme', format: 'json' },
      { MCP_RESPONSE_BUDGET: '2000' },
    );
    expect(isError).toBe(false);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toMatch(/^<untrusted source="glitchtip-config" field="status_pages">/);
    const parsed = JSON.parse(unfence(text));
    expect(parsed).toHaveProperty('statusPages');
  });
});
