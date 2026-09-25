import { afterEach, describe, expect, it } from 'vitest';
import malformedMember from '../../fixtures/members/malformed-member.json';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 9: a malformed/partial GlitchTip response (user: null, missing email/role)
// degrades the text output instead of throwing (never "Internal error"); a field of the wrong
// type is the `malformed` tool error.

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
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'members', GLITCHTIP_READ_ONLY: 'false' },
    mock,
  );
  const result = await booted.client.callTool({ name, arguments: args });
  return { text: resultText(result), isError: result.isError === true };
}

describe('list_members', () => {
  it('renders a member with user: null and missing email/role without throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/members/`, [
      malformedMember,
    ]);
    const { text, isError } = await call(mock, 'list_members', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).not.toContain('Internal error');
    expect(text).toContain('42');
    // The name falls back to an em dash; the email fence is present but empty.
    expect(text).toContain('<untrusted source="glitchtip-user" field="member.email"></untrusted>');
  });
});

describe('get_member', () => {
  it('renders a member with user: null and missing email/role without throwing', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/members/42/`,
      malformedMember,
    );
    const { text, isError } = await call(mock, 'get_member', {
      organization: 'acme',
      member_id: 42,
    });
    expect(isError).toBe(false);
    expect(text).toContain('id: 42');
    expect(text).toContain('teams: 0');
    expect(text).not.toContain('Internal error');
  });

  it('is a malformed tool error naming get_member when teams is not an array', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/members/42/`, {
      ...malformedMember,
      email: 'a@b.test',
      role: 'member',
      teams: 'oops',
    });
    const { text, isError } = await call(mock, 'get_member', {
      organization: 'acme',
      member_id: 42,
    });
    expect(isError).toBe(true);
    expect(text).toMatch(MALFORMED);
    expect(text).toContain('get_member');
    expect(text).not.toContain('Internal error');
  });
});
