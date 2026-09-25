import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../support/boot';
import { MockGlitchTip } from '../support/mock-glitchtip';

// Acceptance 1, 2 and 3: the projects toolset's read tools, and the gate this item carries
// (AGENTS.md rule 4, docs/roadmap.md "registration"): read-only mode hides the mutating tools,
// with GLITCHTIP_TOOLSETS=projects pinned here rather than relying on another toolset's fixture.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

const PROJECT_TEAM_ITEM = {
  id: '1',
  slug: 'web',
  name: 'Web',
  platform: 'python',
  firstEvent: '2026-01-02T03:04:05Z',
  teams: [{ id: '1', slug: 'core' }],
};

const PROJECT_DETAIL = {
  id: '1',
  slug: 'web',
  name: 'Web',
  platform: 'python',
  dateCreated: '2026-01-02T03:04:05Z',
  firstEvent: '2026-01-03T00:00:00Z',
  eventThrottleRate: 5,
  scrubIPAddresses: true,
  isPublic: false,
  isBookmarked: true,
  organization: { slug: 'acme' },
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
      GLITCHTIP_TOOLSETS: 'projects',
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

describe('read-only mode, pinned to GLITCHTIP_TOOLSETS=projects', () => {
  it('lists whoami and the 7 read tools only when read-only', async () => {
    booted = await bootInMemory(
      { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'projects', GLITCHTIP_READ_ONLY: 'true' },
      new MockGlitchTip(),
    );
    const { tools } = await booted.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_project',
      'get_project_key',
      'list_project_environments',
      'list_project_keys',
      'list_project_teams',
      'list_projects',
      'list_team_projects',
      'whoami',
    ]);
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }
    await expect(
      booted.client.callTool({
        name: 'delete_project',
        arguments: { project: 'web', confirm: 'web' },
      }),
    ).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('Unknown tool') });
  });

  it('lists whoami and all 16 project tools when writes are enabled', async () => {
    booted = await bootInMemory(
      { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'projects', GLITCHTIP_READ_ONLY: 'false' },
      new MockGlitchTip(),
    );
    const { tools } = await booted.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_team_to_project',
      'create_project',
      'create_project_key',
      'delete_project',
      'delete_project_key',
      'get_project',
      'get_project_key',
      'list_project_environments',
      'list_project_keys',
      'list_project_teams',
      'list_projects',
      'list_team_projects',
      'remove_team_from_project',
      'set_project_environment_visibility',
      'update_project',
      'update_project_key',
      'whoami',
    ]);
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('delete_project')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(byName.get('update_project')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(byName.get('create_project')?.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: false,
    });
  });
});

describe('list_projects', () => {
  it('renders a table, sends query/limit/cursor', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/projects/`, [
      PROJECT_TEAM_ITEM,
    ]);
    const { text } = await call(mock, 'list_projects', {
      organization: 'acme',
      query: '!team:core',
      limit: 10,
      cursor: 'c0',
    });
    expect(text).toContain('web');
    expect(text).toContain('python');
    expect(text).toContain('core');
    expect(mock.requests[0].url.searchParams.get('query')).toBe('!team:core');
    expect(mock.requests[0].url.searchParams.get('limit')).toBe('10');
    expect(mock.requests[0].url.searchParams.get('cursor')).toBe('c0');
  });

  it('says so when the list is empty, without isError', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/projects/`, []);
    const { text, isError } = await call(mock, 'list_projects', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).toBe('No projects in this organization.');
  });

  it('shows "no events yet" when there is no first event', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/projects/`, [
      { ...PROJECT_TEAM_ITEM, firstEvent: null },
    ]);
    const { text } = await call(mock, 'list_projects', { organization: 'acme' });
    expect(text).toContain('no events yet');
  });

  it('turns a 401 into an actionable tool error', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/projects/`,
      {},
      { status: 401 },
    );
    const { text, isError } = await call(mock, 'list_projects', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toBe('The GlitchTip token was rejected (401). Check the token.');
  });
});

describe('get_project', () => {
  it('shows the full detail projection', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/web/`, PROJECT_DETAIL);
    const { text } = await call(mock, 'get_project', { organization: 'acme', project: 'web' });
    expect(text).toContain('slug: web');
    expect(text).toContain('event throttle rate: 5');
    expect(text).toContain('ip scrubbing: true');
    expect(text).toContain('bookmarked: true');
    expect(text).toContain('organization: acme');
  });

  it('uses GLITCHTIP_DEFAULT_ORG without a lookup', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/web/`, PROJECT_DETAIL);
    await call(mock, 'get_project', { project: 'web' }, { GLITCHTIP_DEFAULT_ORG: 'acme' });
    expect(mock.requests.map((r) => r.url.pathname)).toEqual(['/api/0/projects/acme/web/']);
  });

  it('maps 404 to a not-found message naming the project and organization', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/gone/`, {}, { status: 404 });
    const { text, isError } = await call(mock, 'get_project', {
      organization: 'acme',
      project: 'gone',
    });
    expect(isError).toBe(true);
    expect(text).toBe('Project gone was not found in acme.');
  });

  it('maps 403 to the read scopes', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/web/`, {}, { status: 403 });
    const { text } = await call(mock, 'get_project', { organization: 'acme', project: 'web' });
    expect(text).toBe(
      'The token lacks permission for get project. It needs one of: project:read, project:write, project:admin.',
    );
  });
});

describe('list_team_projects', () => {
  it('lists the team projects', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/teams/acme/core/projects/`, [
      { slug: 'web', name: 'Web', platform: 'python', firstEvent: null, id: '1' },
    ]);
    const { text } = await call(mock, 'list_team_projects', { organization: 'acme', team: 'core' });
    expect(text).toContain('web');
    expect(text).toContain('no events yet');
  });

  it('says so when there are none', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/teams/acme/core/projects/`, []);
    const { text } = await call(mock, 'list_team_projects', { organization: 'acme', team: 'core' });
    expect(text).toBe('No projects for team core.');
  });
});

describe('list_project_environments', () => {
  it('lists names and hidden state, passes visibility', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/web/environments/`, [
      { name: 'production', isHidden: false },
      { name: 'staging', isHidden: true },
    ]);
    const { text } = await call(mock, 'list_project_environments', {
      organization: 'acme',
      project: 'web',
      visibility: 'all',
    });
    expect(text).toContain('production');
    expect(text).toContain('staging');
    expect(mock.requests[0].url.searchParams.get('visibility')).toBe('all');
  });

  it('says so when there are none', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/web/environments/`, []);
    const { text } = await call(mock, 'list_project_environments', {
      organization: 'acme',
      project: 'web',
    });
    expect(text).toBe('No environments in web (visibility: visible).');
  });
});

describe('list_project_teams', () => {
  it('lists the attached teams', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/web/teams/`, [
      { id: '1', slug: 'core', memberCount: 3 },
    ]);
    const { text } = await call(mock, 'list_project_teams', {
      organization: 'acme',
      project: 'web',
    });
    expect(text).toContain('core');
    expect(text).toContain('3');
  });

  it('says so when there are none', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/projects/acme/web/teams/`, []);
    const { text } = await call(mock, 'list_project_teams', {
      organization: 'acme',
      project: 'web',
    });
    expect(text).toBe('No teams attached to project web.');
  });
});

describe('network failures', () => {
  it('become an unreachable tool error, not a crash', async () => {
    const mock = new MockGlitchTip().on('GET', `${API}/organizations/acme/projects/`, () => {
      throw new TypeError('fetch failed');
    });
    const { text, isError } = await call(mock, 'list_projects', { organization: 'acme' });
    expect(isError).toBe(true);
    expect(text).toBe(`Could not reach ${GLITCHTIP}.`);
  });
});
