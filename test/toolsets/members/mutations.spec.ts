import { afterEach, describe, expect, it } from 'vitest';
import { type Booted, bootInMemory, GLITCHTIP, resultText } from '../../support/boot';
import { jsonResponse, MockGlitchTip } from '../../support/mock-glitchtip';

// Acceptance 5, 6, 7: invite_member, update_member_role, remove_member,
// transfer_organization_ownership — method/path/body assertions, confirm guards, the invite
// link gate, the reinvite default, and error paths.

const API = `${GLITCHTIP}/api/0`;
const TOKEN = 'tok_TEST';

const MEMBER_DETAIL = {
  id: '7',
  role: 'admin',
  roleName: 'Admin',
  dateCreated: '2026-01-02T03:04:05Z',
  email: 'dev@example.test',
  user: { id: '9', name: 'Dev Person' },
  pending: false,
  isOwner: false,
  teams: [],
};

const INVITE_RESPONSE = {
  id: '8',
  role: 'member',
  roleName: 'Member',
  dateCreated: '2026-01-02T03:04:05Z',
  email: 'new@example.test',
  user: null,
  pending: true,
  isOwner: false,
  inviteLink: 'https://glitchtip.test/accept/1/tok/',
};

let booted: Booted | undefined;
afterEach(async () => {
  await booted?.close();
  booted = undefined;
});

async function boot(mock: MockGlitchTip, env: NodeJS.ProcessEnv = {}) {
  booted = await bootInMemory(
    { GLITCHTIP_TOKEN: TOKEN, GLITCHTIP_TOOLSETS: 'members', GLITCHTIP_READ_ONLY: 'false', ...env },
    mock,
  );
  return booted.client;
}

/** Strips the whole-result `<untrusted source="glitchtip-user" field="member">…</untrusted>` fence. */
function unfence(text: string): string {
  return text.replace(/^<untrusted[^>]*>/, '').replace(/<\/untrusted>$/, '');
}

async function call(mock: MockGlitchTip, name: string, args: Record<string, unknown>, env = {}) {
  const client = await boot(mock, env);
  const result = await client.callTool({ name, arguments: args });
  return { result, text: resultText(result), isError: result.isError === true };
}

describe('invite_member', () => {
  it('posts email/orgRole/teamRoles/reinvite, never sendInvite, and hides the invite link by default', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/members/`,
      jsonResponse(INVITE_RESPONSE, 201),
    );
    const { text } = await call(mock, 'invite_member', {
      organization: 'acme',
      email: 'new@example.test',
      role: 'member',
      teams: ['core', 'ops'],
    });
    const body = JSON.parse(mock.requests[0].body);
    expect(body).toEqual({
      email: 'new@example.test',
      orgRole: 'member',
      teamRoles: [{ teamSlug: 'core' }, { teamSlug: 'ops' }],
      reinvite: false,
    });
    expect(body).not.toHaveProperty('sendInvite');
    expect(text).not.toContain('inviteLink');
    expect(text).not.toContain('accept/1/tok');
    expect(text).toContain('Requested teams: core, ops');
  });

  it('includes the invite link only when asked', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/members/`,
      jsonResponse(INVITE_RESPONSE, 201),
    );
    const { text } = await call(mock, 'invite_member', {
      organization: 'acme',
      email: 'new@example.test',
      role: 'member',
      include_invite_link: true,
    });
    expect(text).toContain('This link grants membership; share it only with the invitee.');
    expect(text).toContain('https://glitchtip.test/accept/1/tok/');
  });

  it('omits inviteLink from json unless asked, and includes it when asked', async () => {
    const mock = new MockGlitchTip().on(
      'POST',
      `${API}/organizations/acme/members/`,
      jsonResponse(INVITE_RESPONSE, 201),
    );
    const hidden = await call(mock, 'invite_member', {
      organization: 'acme',
      email: 'new@example.test',
      role: 'member',
      format: 'json',
    });
    expect(JSON.parse(unfence(hidden.text))).not.toHaveProperty('inviteLink');

    const shown = await call(mock, 'invite_member', {
      organization: 'acme',
      email: 'new@example.test',
      role: 'member',
      include_invite_link: true,
      format: 'json',
    });
    expect(JSON.parse(unfence(shown.text)).inviteLink).toBe('https://glitchtip.test/accept/1/tok/');
  });

  it('refuses duplicate teams before any request', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'invite_member', {
      organization: 'acme',
      email: 'new@example.test',
      role: 'member',
      teams: ['core', 'core'],
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('refuses an invalid email before any request', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'invite_member', {
      organization: 'acme',
      email: 'not-an-email',
      role: 'member',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Invalid parameters');
    expect(mock.requests).toHaveLength(0);
  });

  it('adds the reinvite hint on a 409 that says already invited', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      `${API}/organizations/acme/members/`,
      { detail: 'dev@example.test is already invited' },
      { status: 409 },
    );
    const { text, isError } = await call(mock, 'invite_member', {
      organization: 'acme',
      email: 'dev@example.test',
      role: 'member',
    });
    expect(isError).toBe(true);
    expect(text).toContain('already invited');
    expect(text).toContain('Pass `reinvite: true` to send the invite again.');
  });

  it('maps 429 to the rate-limit message', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      `${API}/organizations/acme/members/`,
      {},
      { status: 429 },
    );
    const { text, isError } = await call(mock, 'invite_member', {
      organization: 'acme',
      email: 'new@example.test',
      role: 'member',
    });
    expect(isError).toBe(true);
    expect(text).toContain('rate-limiting');
  });
});

describe('update_member_role', () => {
  it('sends exactly { orgRole } and shows the updated member', async () => {
    const mock = new MockGlitchTip().json(
      'PUT',
      `${API}/organizations/acme/members/7/`,
      MEMBER_DETAIL,
    );
    const { text } = await call(mock, 'update_member_role', {
      organization: 'acme',
      member_id: 7,
      role: 'admin',
    });
    expect(JSON.parse(mock.requests[0].body)).toEqual({ orgRole: 'admin' });
    expect(text).toContain('role: admin');
  });

  it('passes through the last-owner 422', async () => {
    const mock = new MockGlitchTip().json(
      'PUT',
      `${API}/organizations/acme/members/7/`,
      { detail: 'The organization must keep at least one owner.' },
      { status: 422 },
    );
    const { text, isError } = await call(mock, 'update_member_role', {
      organization: 'acme',
      member_id: 7,
      role: 'member',
    });
    expect(isError).toBe(true);
    expect(text).toContain('The organization must keep at least one owner.');
  });

  it('maps 404 to a message pointing at list_members', async () => {
    const mock = new MockGlitchTip().json(
      'PUT',
      `${API}/organizations/acme/members/9/`,
      {},
      { status: 404 },
    );
    const { text, isError } = await call(mock, 'update_member_role', {
      organization: 'acme',
      member_id: 9,
      role: 'member',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Member 9 was not found in acme');
  });
});

describe('remove_member', () => {
  it('deletes when confirm matches', async () => {
    const mock = new MockGlitchTip().on(
      'DELETE',
      `${API}/organizations/acme/members/7/`,
      new Response(null, { status: 204 }),
    );
    const { text, isError } = await call(mock, 'remove_member', {
      organization: 'acme',
      member_id: 7,
      confirm: '7',
    });
    expect(isError).toBe(false);
    expect(text).toBe('Removed member 7 from acme.');
  });

  it('refuses when confirm does not equal member_id, without calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'remove_member', {
      organization: 'acme',
      member_id: 7,
      confirm: '8',
    });
    expect(isError).toBe(true);
    expect(text).toContain('confirm must equal the member id "7"');
    expect(mock.requests).toHaveLength(0);
  });

  it('passes through the primary-owner 400', async () => {
    const mock = new MockGlitchTip().json(
      'DELETE',
      `${API}/organizations/acme/members/7/`,
      { detail: 'Transfer ownership first.' },
      { status: 400 },
    );
    const { text, isError } = await call(mock, 'remove_member', {
      organization: 'acme',
      member_id: 7,
      confirm: '7',
    });
    expect(isError).toBe(true);
    expect(text).toContain('Transfer ownership first.');
  });
});

describe('transfer_organization_ownership', () => {
  it('posts to set_owner when confirm matches', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      `${API}/organizations/acme/members/7/set_owner/`,
      {
        ...MEMBER_DETAIL,
        isOwner: true,
      },
    );
    const { text, isError } = await call(mock, 'transfer_organization_ownership', {
      organization: 'acme',
      member_id: 7,
      confirm: '7',
    });
    expect(isError).toBe(false);
    expect(text).toContain('owner: true');
  });

  it('refuses when confirm does not equal member_id, without calling GlitchTip', async () => {
    const mock = new MockGlitchTip();
    const { text, isError } = await call(mock, 'transfer_organization_ownership', {
      organization: 'acme',
      member_id: 7,
      confirm: 'nope',
    });
    expect(isError).toBe(true);
    expect(text).toContain('confirm must equal the member id "7"');
    expect(mock.requests).toHaveLength(0);
  });

  it('maps 403 to member:admin', async () => {
    const mock = new MockGlitchTip().json(
      'POST',
      `${API}/organizations/acme/members/7/set_owner/`,
      {},
      { status: 403 },
    );
    const { text } = await call(mock, 'transfer_organization_ownership', {
      organization: 'acme',
      member_id: 7,
      confirm: '7',
    });
    expect(text).toContain('It needs one of: member:admin.');
  });
});
