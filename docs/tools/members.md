# Toolset `members`

Default off (`GLITCHTIP_TOOLSETS` must name `members`, D-06). The four
mutating tools are registered only when `GLITCHTIP_READ_ONLY=false`; in
read-only mode they are absent from `tools/list` and calling one answers
`-32602 Unknown tool`.

Every tool accepts `organization` (optional — see "Default organization" in
`docs/tools/organizations.md`) and `format`: `text` (default, compact) or
`json` (the same projected fields as JSON, never the raw GlitchTip payload).
Every result is bounded by `MCP_RESPONSE_BUDGET`. All tools carry
`openWorldHint: true`.

**Untrusted content (D-18).** A member's email and `user.name` are written by
the person themself (self-registration, their own profile), not by the
operator. `list_members` and `get_member`, and the three mutations whose
output carries a member's identity (`invite_member`, `update_member_role`,
`transfer_organization_ownership`), fence them as
`<untrusted source="glitchtip-user" field="...">...</untrusted>` in `text`
format (flattened to one line, HTML-escaped inside the fence). `json` format
returns the same values unwrapped inside the JSON; the whole JSON result is
wrapped in one `<untrusted source="glitchtip-user" field="members">…
</untrusted>` fence for `list_members`, or `field="member"` for the four
single-member tools (`BUG-20260925-006`). A JSON result over
`MCP_RESPONSE_BUDGET` stays valid JSON. In every tool description this warning
is the *last* sentence, after `Scope:`. Team slugs are operator-controlled and
slug-restricted, not fenced.

Scopes are those GlitchTip 6.2.6 checks (`@has_permission` and handler bodies
in `apps/organizations_ext/api.py`); a token that has none of them gets a tool
error naming the scopes it needs.

| Tool | GlitchTip endpoint | readOnly | destructive | idempotent | Scopes (any one) | Read-only mode |
|---|---|---|---|---|---|---|
| `list_members` | `GET /api/0/organizations/{organization_slug}/members/` or `GET /api/0/teams/{organization_slug}/{team_slug}/members/` | yes | no | yes | `member:read`, `member:write`, `member:admin` | listed |
| `get_member` | `GET /api/0/organizations/{organization_slug}/members/{member_id}/` | yes | no | yes | `member:read`, `member:write`, `member:admin` | listed |
| `invite_member` | `POST /api/0/organizations/{organization_slug}/members/` | no | no | no | `member:write`, `member:admin` | hidden |
| `update_member_role` | `PUT /api/0/organizations/{organization_slug}/members/{member_id}/` | no | no | yes | `member:write`, `member:admin` | hidden |
| `remove_member` | `DELETE /api/0/organizations/{organization_slug}/members/{member_id}/` | no | yes | no | `member:admin` | hidden |
| `transfer_organization_ownership` | `POST /api/0/organizations/{organization_slug}/members/{member_id}/set_owner/` | no | yes | yes | `member:admin` | hidden |

Team membership itself (`add_member_to_team`, `remove_member_from_team`) lives
in the `teams` toolset (its scope family is `team:*`, not `member:*`); see
`docs/tools/teams.md`.

## `list_members`

List organization members and pending invites with their role; pass `team`
for one team's members.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `team` | team slug | whole organization |
| `limit` | integer 1–100 | 50 |
| `cursor` | string | first page |
| `format` | `"text"` \| `"json"` | `text` |

Text output is a table (`id`, `role`, `pending`, `owner`, `joined`) with the
fenced email and name appended per row, outside the table's 80-character cell
cut, followed by `next cursor: <cursor>` when there is another page. An empty
result reads `No members in <organization>.` or `No members in
<organization>/<team>.`

## `get_member`

Get one organization member in full: role, invite status, team slugs, and
account details (`isActive`, `lastLogin`, `dateJoined`).

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `member_id` | positive integer, from `list_members` | required |
| `format` | `"text"` \| `"json"` | `text` |

`member_id` is not a user id; a wrong one gets a 404 naming `list_members` as
where the right one comes from.

## `invite_member`

Invite someone to the organization by email with an organization role and
optional teams. GlitchTip always sends the invite email.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `email` | valid email | required |
| `role` | `"member"` \| `"admin"` \| `"manager"` \| `"owner"` | required |
| `teams` | 1–20 team slugs, no duplicates | none |
| `reinvite` | boolean | `false` |
| `include_invite_link` | boolean | `false` |
| `format` | `"text"` \| `"json"` | `text` |

`reinvite` defaults to `false` here although GlitchTip's own default is
`true`: an agent that retries a failed call must not silently re-send the
invite email. Duplicate `teams` entries are rejected before any request.
GlitchTip drops unknown team slugs without error and does not echo which
slugs applied, so the result reports what was requested — `Requested teams:
<slugs>; GlitchTip ignores unknown slugs — check with get_member.` — not what
was applied. The response's `inviteLink` carries the acceptance token: whoever
holds it can join. It appears only when `include_invite_link: true`, preceded
by `This link grants membership; share it only with the invitee.`, and is
never logged. `OrganizationUserIn` marks `sendInvite` and `TeamRole.role`
required, but GlitchTip never reads either (the invite email always sends;
`TeamRole.role` "does nothing at this time"), so both are left off the wire
body. A 409 that says "already invited" gets `Pass reinvite: true to send the
invite again.` appended; a 429 is the foundation's rate-limit message
(mutations are never retried, D-13).

## `update_member_role`

Change a member's organization role.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `member_id` | positive integer | required |
| `role` | `"member"` \| `"admin"` \| `"manager"` \| `"owner"` | required |
| `format` | `"text"` \| `"json"` | `text` |

`OrganizationUserUpdateSchema` has `orgRole` (required) and `teamRoles`
(never read by the handler), so the request body is exactly `{ orgRole: role
}`. Demoting the organization's last owner gets GlitchTip's 422 passed
through: "The organization must keep at least one owner."

## `remove_member`

Remove a member or cancel a pending invite. Their account is not deleted.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `member_id` | positive integer | **required**: a destructive call never uses a default |
| `confirm` | string | required; must equal `member_id` (as a string) exactly |
| `format` | `"text"` \| `"json"` | `text` |

A `confirm` that differs from `member_id` is refused before GlitchTip is
called. Removing the primary owner, or the organization's last member, gets
GlitchTip's 400 passed through ("Transfer ownership first." / "Delete the
organization instead.").

## `transfer_organization_ownership`

Make a member the organization's single primary owner. Only the current
primary owner or an owner-role member can do this. It is not a deletion, but
the current primary owner loses primary ownership and, without the owner
role, the ability to reverse it — so this tool is destructive despite being
idempotent.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `member_id` | positive integer | **required**: a destructive call never uses a default |
| `confirm` | string | required; must equal `member_id` (as a string) exactly |
| `format` | `"text"` \| `"json"` | `text` |

Output is the returned member with its owner marker.
