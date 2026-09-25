import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// BUG-20260925-006 through the MCP protocol: JSON over the budget stays valid
// JSON (acceptance 3), and a response of an unexpected shape is a `malformed`
// agent error, never "Internal error" (acceptance 4).

const API = `${GLITCHTIP}/api/0`;
const MALFORMED =
  /^GlitchTip returned a response this server did not expect for get_organization \(([0-9a-f-]{36})\)\. The request itself succeeded; try format "json"/;

const ORG_DETAIL = {
  id: '1',
  slug: 'acme',
  name: 'Acme',
  dateCreated: '2026-01-02T03:04:05Z',
  status: { id: 'active', name: 'active' },
  avatar: {},
  isEarlyAdopter: false,
  require2fa: false,
  isAcceptingEvents: true,
  eventThrottleRate: 0,
  openMembership: true,
  access: ['org:read'],
  projects: [{ slug: 'web', name: 'Web', teams: [] }],
  teams: [],
};

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
    { GLITCHTIP_TOKEN: 'tok_TEST', GLITCHTIP_TOOLSETS: 'organizations', ...env },
    mock,
  );
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

describe('format: "json" under MCP_RESPONSE_BUDGET (acceptance 3)', () => {
  it('list_organizations with 300 organizations and a 2000 budget returns parseable, truncated JSON', async () => {
    const organizations = Array.from({ length: 300 }, (_, i) => ({
      id: String(i),
      slug: `org-${i}`,
      name: `Organization ${i}`,
      dateCreated: '2026-01-02T03:04:05Z',
    }));
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/`, organizations);
    const { text, isError } = await call(
      mock,
      'list_organizations',
      { format: 'json' },
      { MCP_RESPONSE_BUDGET: '2000' },
    );
    expect(isError).toBe(false);
    expect(text.length).toBeLessThanOrEqual(2_000);
    const parsed = JSON.parse(text) as {
      truncated: boolean;
      hint: string;
      organizations: { slug: string }[];
    };
    expect(parsed.truncated).toBe(true);
    expect(parsed.hint).toMatch(/^Result exceeded the response budget/);
    expect(parsed.organizations.length).toBeGreaterThan(0);
    expect(parsed.organizations[0].slug).toBe('org-0');
  });
});

describe('malformed responses (acceptance 4)', () => {
  it('a view that throws while it is constructed (projects: null) is a malformed error naming the tool', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/`, {
      ...ORG_DETAIL,
      projects: null,
    });
    const { text, isError } = await call(mock, 'get_organization', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).not.toContain('Internal error');
    const id = MALFORMED.exec(text)?.[1];
    expect(booted?.logs()).toContain(`"errorId":"${id}"`);
  });

  it('a view that throws inside text() (access: null) gives the same result through render', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/`, {
      ...ORG_DETAIL,
      access: null,
    });
    const { text, isError } = await call(mock, 'get_organization', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    const id = MALFORMED.exec(text)?.[1];
    const logs = booted?.logs() ?? '';
    expect(logs).toContain(`"errorId":"${id}"`);
    expect(logs).toContain('MalformedViewError');
  });

  it('a list endpoint answering with an object is malformed, not an empty list', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/`, { results: [] });
    const { text, isError } = await call(mock, 'list_organizations', {});
    expect(isError).toBe(true);
    expect(text).toMatch(/^GlitchTip answered list organizations with something other than a list/);
  });
});
