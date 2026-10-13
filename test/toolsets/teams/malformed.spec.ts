import { afterEach, describe, expect, it } from 'vitest';
import malformedTeam from '../../fixtures/teams/malformed-team.json';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 9: a malformed/partial GlitchTip response degrades the text output instead of
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
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'teams', GLITCHTIP_READ_ONLY: 'false' },
    mock,
  );
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

describe('list_teams', () => {
  it('renders a team missing projects without throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/teams/`, [
      malformedTeam,
    ]);
    const { text, isError } = await call(mock, 'list_teams', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).toContain('core');
    expect(text).not.toContain('Internal error');
  });
});

describe('get_team', () => {
  it('renders a team missing projects without throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/teams/acme/core/`, malformedTeam);
    const { text, isError } = await call(mock, 'get_team', { organization: 'acme', team: 'core' });
    expect(isError).toBe(false);
    expect(text).toContain('slug: core');
    expect(text).toContain('projects: none');
  });

  it('marks a null dateCreated with "?" instead of throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/teams/acme/core/`, {
      ...malformedTeam,
      dateCreated: null,
    });
    const { text, isError } = await call(mock, 'get_team', { organization: 'acme', team: 'core' });
    expect(isError).toBe(false);
    expect(text).toContain('created: ?');
    expect(text).not.toContain('Internal error');
  });

  it('degrades to a plain result, not `malformed`, when GlitchTip answers with no body', async () => {
    const mock = new MockGlitchTip().on(
      'GET',
      `${API}/teams/acme/core/`,
      new Response(null, { status: 204 }),
    );
    const { text, isError } = await call(mock, 'get_team', { organization: 'acme', team: 'core' });
    expect(isError).toBe(false);
    expect(text).toBe('Team core in acme: GlitchTip returned no body (?).');
  });

  it('is a malformed tool error naming get_team when projects is not an array', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/teams/acme/core/`, {
      ...malformedTeam,
      projects: 'oops',
    });
    const { text, isError } = await call(mock, 'get_team', { organization: 'acme', team: 'core' });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('get_team');
    expect(text).not.toContain('Internal error');
  });
});
