import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { jsonResponse, MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 3, 5, 7: create_team, rename_team, delete_team, add_member_to_team,
// remove_member_from_team — method/path/body assertions, confirm guards, error paths.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

const TEAM = {
  id: '1',
  slug: 'core',
  dateCreated: '2026-01-02T03:04:05Z',
  isMember: true,
  memberCount: 1,
  projects: [],
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

describe('create_team', () => {
  it('posts the slug and shows the re-read team', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/teams/`,
      jsonResponse(TEAM, 201),
    );
    const { text } = await call(mock, 'create_team', { organization: 'acme', slug: 'core' });
    expect(JSON.parse(mock.requests[0].body)).toEqual({ slug: 'core' });
    expect(text).toContain('slug: core');
  });

  it('names the organization-role rule on 404', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      `${API}/organizations/acme/teams/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'create_team', {
      organization: 'acme',
      slug: 'core',
    });
    expect(isError).toBe(true);
    expect(text).toBe(
      'Could not create team core in acme: organization not found, or your organization role is below admin.',
    );
  });

  it('gives a duplicate-slug hint on 500', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      `${API}/organizations/acme/teams/`,
      {},
      { status: 500 },
    );
    const { text, isError } = await call(mock, 'create_team', {
      organization: 'acme',
      slug: 'core',
    });
    expect(isError).toBe(true);
    expect(text).toBe(
      'GlitchTip returned 500; a team with slug core may already exist in acme — check with get_team.',
    );
  });
});

describe('rename_team', () => {
  it('sends exactly { slug } and shows the renamed team', async () => {
    const mock = new MockGlitchTip().json('PUT', `${API}/teams/acme/core/`, {
      ...TEAM,
      slug: 'kernel',
    });
    const { text } = await call(mock, 'rename_team', {
      organization: 'acme',
      team: 'core',
      new_slug: 'kernel',
    });
    expect(JSON.parse(mock.requests[0].body)).toEqual({ slug: 'kernel' });
    expect(text).toContain('slug: kernel');
  });

  it('refuses new_slug equal to team before any request', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'rename_team', {
      organization: 'acme',
      team: 'core',
      new_slug: 'core',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('gives a duplicate-slug hint on 500', async () => {
    const mock = new MockGlitchTip().json('PUT', `${API}/teams/acme/core/`, {}, { status: 500 });
    const { text, isError } = await call(mock, 'rename_team', {
      organization: 'acme',
      team: 'core',
      new_slug: 'kernel',
    });
    expect(isError).toBe(true);
    expect(text).toBe(
      'GlitchTip returned 500; a team with slug kernel may already exist in acme — check with get_team.',
    );
  });
});

describe('delete_team', () => {
  it('deletes when confirm matches', async () => {
    const mock = new MockGlitchTip().on(
      'DELETE',
      `${API}/teams/acme/core/`,
      new Response(null, { status: 204 }),
    );
    const { text, isError } = await call(mock, 'delete_team', {
      organization: 'acme',
      team: 'core',
      confirm: 'core',
    });
    expect(isError).toBe(false);
    expect(text).toBe('Deleted team core from acme.');
  });

  it('refuses when confirm does not equal team, without calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'delete_team', {
      organization: 'acme',
      team: 'core',
      confirm: 'nope',
    });
    expect(isError).toBe(true);
    expect(text).toContain('confirm must equal the team slug "core"');
    expect(mock.requests).toHaveLength(0);
  });

  it('names the organization-role rule on 404', async () => {
    const mock = new MockGlitchTip().json('DELETE', `${API}/teams/acme/core/`, {}, { status: 404 });
    const { text, isError } = await call(mock, 'delete_team', {
      organization: 'acme',
      team: 'core',
      confirm: 'core',
    });
    expect(isError).toBe(true);
    expect(text).toBe('Team core was not found in acme, or your organization role is below admin.');
  });
});

describe('add_member_to_team', () => {
  it('posts to the member/team route and shows the re-read team', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/members/7/teams/core/`,
      jsonResponse({ ...TEAM, memberCount: 2 }, 201),
    );
    const { text } = await call(mock, 'add_member_to_team', {
      organization: 'acme',
      member: 7,
      team: 'core',
    });
    expect(text).toContain('memberCount: 2');
  });

  it('accepts "me"', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/members/me/teams/core/`,
      jsonResponse(TEAM, 201),
    );
    const { isError } = await call(mock, 'add_member_to_team', {
      organization: 'acme',
      member: 'me',
      team: 'core',
    });
    expect(isError).toBe(false);
  });

  it('maps 403 to the team-write scopes plus GlitchTip’s role rule', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      `${API}/organizations/acme/members/7/teams/core/`,
      {},
      { status: 403 },
    );
    const { text } = await call(mock, 'add_member_to_team', {
      organization: 'acme',
      member: 7,
      team: 'core',
    });
    expect(text).toBe(
      'The token lacks permission for add member to team. It needs one of: team:write, team:admin. ' +
        "GlitchTip's rule: self-join is allowed with open membership; otherwise your organization " +
        'role must be manager or higher (admin if you are already a member of the team).',
    );
  });
});

describe('remove_member_from_team', () => {
  it('deletes the member/team route and shows the re-read team', async () => {
    const mock = new MockGlitchTip().json(
      'DELETE',
      `${API}/organizations/acme/members/7/teams/core/`,
      {
        ...TEAM,
        memberCount: 0,
      },
    );
    const { text, isError } = await call(mock, 'remove_member_from_team', {
      organization: 'acme',
      member: 7,
      team: 'core',
    });
    expect(isError).toBe(false);
    expect(text).toContain('memberCount: 0');
  });

  it('maps 404 to a message naming both the member and the team', async () => {
    const mock = new MockGlitchTip().json(
      'DELETE',
      `${API}/organizations/acme/members/7/teams/gone/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'remove_member_from_team', {
      organization: 'acme',
      member: 7,
      team: 'gone',
    });
    expect(isError).toBe(true);
    expect(text).toBe(
      'Member 7 or team gone was not found in acme. Member ids come from list_members.',
    );
  });
});
