import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 11 (last sentence): format: "json" over MCP_RESPONSE_BUDGET stays valid JSON, never
// contains `data` (ReleaseSchema.data holds the raw commit list), and the fence source matches
// each tool's declared field.

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
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'releases', ...env },
    mock,
  );
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

function unfence(text: string): string {
  return text.replace(/^<untrusted[^>]*>/, '').replace(/<\/untrusted>$/, '');
}

describe('list_releases json over budget', () => {
  it('stays valid, parseable JSON, fenced as glitchtip-event, without data', async () => {
    const releases = Array.from({ length: 300 }, (_, i) => ({
      version: `1.0.${i}`,
      dateCreated: '2026-01-02T03:04:05Z',
      dateReleased: '2026-01-02T03:04:05Z',
      shortVersion: `1.0.${i}`,
      projects: [{ slug: 'web', name: 'Web' }],
      commitCount: 1,
      deployCount: 1,
      data: { commits: ['huge raw payload'.repeat(100)] },
    }));
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/releases/`, releases);
    const { text, isError } = await call(
      mock,
      'list_releases',
      { organization: 'acme', format: 'json' },
      { MCP_RESPONSE_BUDGET: '2000' },
    );
    expect(isError).toBe(false);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toMatch(/^<untrusted source="glitchtip-event" field="releases">/);
    const parsed = JSON.parse(unfence(text));
    expect(parsed).not.toHaveProperty('data');
    expect(JSON.stringify(parsed)).not.toContain('data');
  });
});

describe('list_release_commits json over budget', () => {
  it('stays valid, parseable JSON, fenced as glitchtip-config', async () => {
    const commits = Array.from({ length: 300 }, (_, i) => ({
      id: `${i}`.padStart(40, '0'),
      message: 'a commit message that repeats. '.repeat(20),
      authorName: 'Dev',
      authorEmail: 'dev@example.test',
      dateCreated: '2026-01-01T00:00:00Z',
    }));
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/releases/1.0.0/commits/`,
      commits,
    );
    const { text, isError } = await call(
      mock,
      'list_release_commits',
      { organization: 'acme', version: '1.0.0', limit: 300, format: 'json' },
      { MCP_RESPONSE_BUDGET: '2000' },
    );
    expect(isError).toBe(false);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toMatch(/^<untrusted source="glitchtip-config" field="commits">/);
    const parsed = JSON.parse(unfence(text));
    expect(parsed).not.toHaveProperty('data');
  });
});
