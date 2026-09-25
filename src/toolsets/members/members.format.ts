import { keyValues, table, withCursor } from '../../format/table';
import type { View } from '../../format/tool-output';
import { untrusted } from '../../format/untrusted';
import type { components } from '../../glitchtip/generated/schema';
import type { Page } from '../../glitchtip/pagination';

type Member = components['schemas']['OrganizationUserSchema'];
type MemberDetail = components['schemas']['OrganizationUserDetailSchema'];
type MemberInvite = components['schemas']['OrganizationUserInviteSchema'];

// Views project GlitchTip's payloads down to the fields an agent uses (D-12).
// A member's email and user.name are written by the person themself, not the
// operator, so they are fenced with untrusted() in text output (D-18,
// source: glitchtip-user); json keeps raw values, the whole result fenced by
// ToolOutput via `untrusted`. Team slugs are operator-controlled and
// slug-restricted, not fenced. Every field read here is guarded against a
// malformed/partial GlitchTip response so a missing optional part (`user:
// null`, a missing email/role) degrades the text; only a field of the wrong
// type throws, which becomes the `malformed` tool error.

const EM_DASH = '—';

export function memberListView(page: Page<Member>, org: string, team: string | undefined): View {
  const members = page.items;
  return {
    untrusted: { field: 'members', source: 'glitchtip-user' },
    text: () => {
      if (members.length === 0) {
        return team ? `No members in ${org}/${team}.` : `No members in ${org}.`;
      }
      const body = table(members, [
        { header: 'id', value: (m) => m.id },
        { header: 'role', value: (m) => m.role },
        { header: 'pending', value: (m) => (m.pending ? 'invited' : '-') },
        { header: 'owner', value: (m) => (m.isOwner ? 'owner' : '-') },
        { header: 'joined', value: (m) => day(m.dateCreated) },
      ]);
      const [header, ...rows] = body.split('\n');
      // Table cells are cut at 80 characters, which would split a fence
      // (D-18): email and name are appended per row, outside the cut.
      const withIdentity = rows.map((line, i) => `${line}  ${identityCell(members[i])}`);
      return withCursor([header, ...withIdentity].join('\n'), page.nextCursor);
    },
    json: () => ({
      members: members.map(memberProjection),
      nextCursor: page.nextCursor ?? null,
    }),
  };
}

export function memberDetailView(member: MemberDetail): View {
  return {
    untrusted: { field: 'member', source: 'glitchtip-user' },
    text: () =>
      keyValues([
        ['id', member.id],
        ['email', emailFence(member.email)],
        ['name', nameFence(member.user?.name)],
        ['role', member.role],
        ['pending', member.pending],
        ['owner', member.isOwner],
        ['joined', day(member.dateCreated)],
        ['teams', countedList(member.teams ?? [])],
        ['active', member.user?.isActive],
        ['lastLogin', member.user?.lastLogin ? day(member.user.lastLogin) : undefined],
        ['dateJoined', member.user?.dateJoined ? day(member.user.dateJoined) : undefined],
      ]),
    json: () => ({
      ...memberProjection(member),
      teams: member.teams ?? [],
      isActive: member.user?.isActive ?? null,
      lastLogin: member.user?.lastLogin ?? null,
      dateJoined: member.user?.dateJoined ?? null,
    }),
  };
}

/**
 * invite_member's response: no `teams` field (GlitchTip does not echo which
 * slugs applied), and the acceptance link only when the caller asked for it.
 */
export function memberInviteView(
  invite: MemberInvite,
  requestedTeams: readonly string[],
  includeInviteLink: boolean,
): View {
  const showLink = includeInviteLink && Boolean(invite.inviteLink);
  return {
    untrusted: { field: 'member', source: 'glitchtip-user' },
    text: () => {
      const lines = keyValues([
        ['id', invite.id],
        ['email', emailFence(invite.email)],
        ['role', invite.role],
        ['pending', invite.pending],
      ]);
      const teamsLine =
        requestedTeams.length > 0
          ? `Requested teams: ${requestedTeams.join(', ')}; GlitchTip ignores unknown slugs — check with \`get_member\`.`
          : undefined;
      const linkLine = showLink
        ? `This link grants membership; share it only with the invitee.\ninviteLink: ${invite.inviteLink}`
        : undefined;
      return [lines, teamsLine, linkLine].filter((l) => l !== undefined).join('\n');
    },
    json: () => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      pending: invite.pending,
      requestedTeams,
      inviteLink: showLink ? invite.inviteLink : undefined,
    }),
  };
}

/** Confirmation of a write with nothing richer to show (D-12). */
export function resultView(summary: string, data: Record<string, unknown> = {}): View {
  return {
    text: () => summary,
    json: () => ({ result: summary, ...data }),
  };
}

interface MemberProjection {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: string;
  readonly pending: boolean;
  readonly isOwner: boolean;
  readonly dateCreated: string;
}

function memberProjection(m: Member | MemberDetail): MemberProjection {
  return {
    id: m.id,
    email: m.email,
    name: m.user?.name ?? null,
    role: m.role,
    pending: m.pending,
    isOwner: m.isOwner,
    dateCreated: m.dateCreated,
  };
}

function identityCell(m: Member): string {
  return `${emailFence(m.email)}  ${nameFence(m.user?.name)}`;
}

function emailFence(email: string | null | undefined): string {
  return untrusted('member.email', flatten(email ?? ''), 'glitchtip-user');
}

function nameFence(name: string | null | undefined): string {
  return name ? untrusted('member.name', flatten(name), 'glitchtip-user') : EM_DASH;
}

function countedList(items: readonly string[]): string {
  return items.length === 0 ? '0' : `${items.length} (${items.join(', ')})`;
}

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function day(iso: string): string {
  return iso.slice(0, 10);
}
