import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 2, 3, 4: list_teams, get_team — method/path/query assertions, the
// project "+N more" cap, the untrusted-free projection, error paths.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

const TEAM = {
  id: '1',
  slug: 'core',
  dateCreated: '2026-01-02T03:04:05Z',
  isMember: true,
  memberCount: 3,
  projects: [
    { id: '1', slug: 'web', name: 'Web', platform: 'python' },
    { id: '2', slug: 'api', name: 'API', platform: 'node' },
  ],
};

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function boot(mock: MockGlitchTip, env: NodeJS.ProcessEnv = {}) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'teams', GLITCHTIP_READ_ONLY: 'false', ...env },
    mock,
  );
  return booted.client;
}

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>, env = {}) {
  const client = await boot(mock, env);
  const result = await client.callTool({ name, arguments: args });
  return { result, text: resultText(result), isError: result.isError === true };
}

describe('list_teams', () => {
  it('renders a table with member count, isMember and projects, and sends limit/cursor', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/teams/`, [TEAM], {
      headers: {
        link: `<${API}/organizations/acme/teams/?cursor=n>; rel="next"; results="true"; cursor="0:2:0"`,
      },
    });
    const { text } = await call(mock, 'list_teams', {
      organization: 'acme',
      limit: 10,
      cursor: 'c0',
    });
    expect(text).toContain('core');
    expect(text).toContain('3');
    expect(text).toContain('web, api');
    expect(text).toContain('next cursor: 0:2:0');
    expect(mock.requests[0].url.searchParams.get('limit')).toBe('10');
    expect(mock.requests[0].url.searchParams.get('cursor')).toBe('c0');
  });

  it('caps the project list to 10 slugs, then "+N more"', async () => {
    const projects = Array.from({ length: 13 }, (_, i) => ({ slug: `p${i}`, name: `P${i}` }));
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/teams/`, [
      { ...TEAM, projects },
    ]);
    const { text } = await call(mock, 'list_teams', { organization: 'acme' });
    expect(text).toContain('p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, +3 more');
  });

  it('says so when there are no teams, without isError', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/teams/`, []);
    const { text, isError } = await call(mock, 'list_teams', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).toBe('No teams in acme.');
  });

  it('returns projected json', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/teams/`, [TEAM]);
    const { text } = await call(mock, 'list_teams', { organization: 'acme', format: 'json' });
    expect(JSON.parse(text)).toEqual({
      teams: [
        {
          slug: 'core',
          id: '1',
          memberCount: 3,
          isMember: true,
          projects: ['web', 'api'],
        },
      ],
      nextCursor: null,
    });
  });

  it('maps 403 to the scopes it needs', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/teams/`,
      {},
      { status: 403 },
    );
    const { text, isError } = await call(mock, 'list_teams', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toBe(
      'The token lacks permission for list teams. It needs one of: team:read, team:write, team:admin, org:read, org:write, org:admin.',
    );
  });

  it('is malformed, not an empty list, when GlitchTip answers with an object', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/teams/`, {
      results: [],
    });
    const { text, isError } = await call(mock, 'list_teams', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toMatch(/^GlitchTip answered list teams with something other than a list/);
  });
});

describe('get_team', () => {
  it('shows slug, member count, isMember and each project', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/teams/acme/core/`, TEAM);
    const { text } = await call(mock, 'get_team', { organization: 'acme', team: 'core' });
    expect(text).toContain('slug: core');
    expect(text).toContain('memberCount: 3');
    expect(text).toContain('isMember: true');
    expect(text).toContain('web (Web, python)');
    expect(text).toContain('api (API, node)');
    expect(text).toContain('Use list_members(team) (members toolset) for who is in it.');
  });

  it('returns projected json', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/teams/acme/core/`, TEAM);
    const { text } = await call(mock, 'get_team', {
      organization: 'acme',
      team: 'core',
      format: 'json',
    });
    expect(JSON.parse(text)).toEqual({
      slug: 'core',
      id: '1',
      dateCreated: '2026-01-02T03:04:05Z',
      memberCount: 3,
      isMember: true,
      projects: [
        { slug: 'web', name: 'Web', platform: 'python' },
        { slug: 'api', name: 'API', platform: 'node' },
      ],
    });
  });

  it('maps 404 to a message naming the team', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/teams/acme/gone/`, {}, { status: 404 });
    const { text, isError } = await call(mock, 'get_team', { organization: 'acme', team: 'gone' });
    expect(isError).toBe(true);
    expect(text).toBe('Team gone was not found in acme.');
  });

  it('refuses a slug over 50 characters before any request', async () => {
    const mock = new MockGlitchTip();
    const { isError, text } = await call(mock, 'get_team', {
      organization: 'acme',
      team: 'x'.repeat(51),
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });
});
