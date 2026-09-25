import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../support/boot';
import { jsonResponse, MockGlitchTip } from '../support/mock-glitchtip';

// Acceptance 3: environment visibility and team attachment against a mocked GlitchTip, plus the
// 403 message the spec asks for on the team tools (the "project.write" upstream quirk).

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

const PROJECT_WITH_TEAMS = {
  id: '1',
  slug: 'web',
  name: 'Web',
  teams: [{ id: '1', slug: 'core' }],
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

describe('set_project_environment_visibility', () => {
  it('puts name and isHidden', async () => {
    const mock = new MockGlitchTip().json(
      'PUT',
      `${API}/projects/acme/web/environments/staging/`,
      { name: 'staging', isHidden: true },
    );
    const { text } = await call(mock, 'set_project_environment_visibility', {
      organization: 'acme',
      project: 'web',
      environment: 'staging',
      hidden: true,
    });
    expect(text).toBe('Hid environment staging in web.');
    expect(JSON.parse(mock.requests[0].body)).toEqual({ name: 'staging', isHidden: true });
  });

  it('maps 403 to the write scopes', async () => {
    const mock = new MockGlitchTip().json(
      'PUT',
      `${API}/projects/acme/web/environments/staging/`,
      {},
      { status: 403 },
    );
    const { text } = await call(mock, 'set_project_environment_visibility', {
      organization: 'acme',
      project: 'web',
      environment: 'staging',
      hidden: false,
    });
    expect(text).toContain('It needs one of: project:write, project:admin.');
  });
});

describe('add_team_to_project', () => {
  it('posts with no body, shows the resulting teams', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/projects/acme/web/teams/core/`,
      jsonResponse(PROJECT_WITH_TEAMS, 201),
    );
    const { text } = await call(mock, 'add_team_to_project', {
      organization: 'acme',
      project: 'web',
      team: 'core',
    });
    expect(text).toBe('Added team core to project web.\nteams: core');
    expect(mock.requests[0].body).toBe('');
  });

  it('names project:admin and the upstream scope quirk on 403', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      `${API}/projects/acme/web/teams/core/`,
      {},
      { status: 403 },
    );
    const { text } = await call(mock, 'add_team_to_project', {
      organization: 'acme',
      project: 'web',
      team: 'core',
    });
    expect(text).toContain('It needs project:admin');
    expect(text).toContain('project.write');
  });
});

describe('remove_team_from_project', () => {
  it('deletes, shows the resulting teams', async () => {
    const mock = new MockGlitchTip().json('DELETE', `${API}/projects/acme/web/teams/core/`, {
      ...PROJECT_WITH_TEAMS,
      teams: [],
    });
    const { text, isError } = await call(mock, 'remove_team_from_project', {
      organization: 'acme',
      project: 'web',
      team: 'core',
    });
    expect(isError).toBe(false);
    expect(text).toBe('Removed team core from project web.\nteams: 0');
  });

  it('names project:admin and the upstream scope quirk on 403', async () => {
    const mock = new MockGlitchTip().json(
      'DELETE',
      `${API}/projects/acme/web/teams/core/`,
      {},
      { status: 403 },
    );
    const { text } = await call(mock, 'remove_team_from_project', {
      organization: 'acme',
      project: 'web',
      team: 'core',
    });
    expect(text).toContain('It needs project:admin');
    expect(text).toContain('project.write');
  });
});
