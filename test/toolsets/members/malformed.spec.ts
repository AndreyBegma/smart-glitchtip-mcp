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

  it('marks the missing role with "?", not "-"', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/members/`, [
      malformedMember,
    ]);
    const { text } = await call(mock, 'list_members', { organization: 'acme' });
    const row = text.split('\n').find((line) => line.includes('42'));
    expect(row).toContain('?');
  });

  it('a hostile name with control, zero-width, bidi and BOM characters flattens to plain text', async () => {
    const hostile = 'A\u0000B\u007fC​D‮E﻿F';
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/members/`, [
      { ...malformedMember, email: 'a@b.test', role: 'member', user: { id: '1', name: hostile } },
    ]);
    const { text, isError } = await call(mock, 'list_members', { organization: 'acme' });
    expect(isError).toBe(false);
    expect(text).toContain('A B C D E F');
    expect(text).not.toContain('\u0000');
    expect(text).not.toContain('​');
    expect(text).not.toContain('‮');
    expect(text).not.toContain('﻿');
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

  it('marks the missing role with "?" in the key-value view too', async () => {
    const mock = new MockGlitchTip().json(
      'GET',
      `${API}/organizations/acme/members/42/`,
      malformedMember,
    );
    const { text } = await call(mock, 'get_member', { organization: 'acme', member_id: 42 });
    expect(text).toContain('role: ?');
  });

  it('marks a null dateCreated with "?" instead of throwing', async () => {
    const mock = new MockGlitchTip().json('GET', `${API}/organizations/acme/members/42/`, {
      ...malformedMember,
      dateCreated: null,
    });
    const { text, isError } = await call(mock, 'get_member', {
      organization: 'acme',
      member_id: 42,
    });
    expect(isError).toBe(false);
    expect(text).toContain('joined: ?');
    expect(text).not.toContain('Internal error');
  });

  it('degrades to a plain result, not `malformed`, when GlitchTip answers with no body', async () => {
    const mock = new MockGlitchTip().on(
      'GET',
      `${API}/organizations/acme/members/42/`,
      new Response(null, { status: 204 }),
    );
    const { text, isError } = await call(mock, 'get_member', {
      organization: 'acme',
      member_id: 42,
    });
    expect(isError).toBe(false);
    expect(text).toBe('Member 42 in acme: GlitchTip returned no body (?).');
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
