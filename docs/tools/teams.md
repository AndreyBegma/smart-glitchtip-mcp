# Toolset `teams`

Default off (`GLITCHTIP_TOOLSETS` must name `teams`, D-06). The five mutating
tools are registered only when `GLITCHTIP_READ_ONLY=false`; in read-only mode
they are absent from `tools/list` and calling one answers `-32602 Unknown
tool`.

Every tool accepts `organization` (optional — see "Default organization" in
`docs/tools/organizations.md`) and `format`: `text` (default, compact) or
`json` (the same projected fields as JSON, never the raw GlitchTip payload).
Every result is bounded by `MCP_RESPONSE_BUDGET`. All tools carry
`openWorldHint: true`. Team slugs and project slugs/names are
operator-controlled and slug-restricted, not event-derived, so no
untrusted-content fence applies to them (contrast `docs/tools/members.md`).

Scopes are those GlitchTip 6.2.6 checks (`@has_permission` and handler bodies
in `apps/teams/api.py`); a token that has none of them gets a tool error
naming the scopes it needs.

| Tool | GlitchTip endpoint | readOnly | destructive | idempotent | Scopes (any one) | Read-only mode |
|---|---|---|---|---|---|---|
| `list_teams` | `GET /api/0/organizations/{organization_slug}/teams/` | yes | no | yes | `team:read`, `team:write`, `team:admin`, `org:read`, `org:write`, `org:admin` | listed |
| `get_team` | `GET /api/0/teams/{organization_slug}/{team_slug}/` | yes | no | yes | `team:read`, `team:write`, `team:admin` | listed |
| `create_team` | `POST /api/0/organizations/{organization_slug}/teams/` | no | no | no | `team:write`, `team:admin`, `org:write`, `org:admin` | hidden |
| `rename_team` | `PUT /api/0/teams/{organization_slug}/{team_slug}/` | no | no | yes | `team:write`, `team:admin` | hidden |
| `delete_team` | `DELETE /api/0/teams/{organization_slug}/{team_slug}/` | no | yes | no | `team:admin` | hidden |
| `add_member_to_team` | `POST /api/0/organizations/{organization_slug}/members/{member_id}/teams/{team_slug}/` | no | no | yes | `team:write`, `team:admin` | hidden |
| `remove_member_from_team` | `DELETE /api/0/organizations/{organization_slug}/members/{member_id}/teams/{team_slug}/` | no | no | yes | `team:write`, `team:admin` | hidden |

Member management that lists *who* is in a team — `list_members(team)` — lives
in the `members` toolset (its scope family is `member:*`, not `team:*`).
Team-to-project association (`list_team_projects`, `list_project_teams`,
`add_team_to_project`, `remove_team_from_project`) lives in `projects`
(FEAT-20260925-004).

## `list_teams`

List the teams of an organization with their member count, whether you are a
member, and their projects.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `limit` | integer 1–100 | 50 |
| `cursor` | string | first page |
| `format` | `"text"` \| `"json"` | `text` |

Text output is a table (`slug`, `id`, `memberCount`, `isMember`, `projects`)
followed by `next cursor: <cursor>` when there is another page. The
`projects` column lists project slugs, the first 10 then `+N more`. An empty
result reads `No teams in <organization>.`

## `get_team`

Get one team: slug, id, creation date, member count, whether you are a
member, and each of its projects (slug, name, platform).

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `team` | slug | required |
| `format` | `"text"` \| `"json"` | `text` |

Ends with a hint: `Use list_members(team) (members toolset) for who is in
it.`

## `create_team`

Create a team; you become its first member. Needs the admin organization
role.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `slug` | team slug | required |
| `format` | `"text"` \| `"json"` | `text` |

Output is the created team in `get_team` shape (the response is the re-read
team). GlitchTip answers 404, not 403, when the caller's organization role is
below admin; the tool cannot tell that apart from the organization itself not
existing, so the message says both. A 500 usually means a team with that slug
already exists (`unique_together = (slug, organization)` has no
`IntegrityError` handler): the message points at `get_team` to check.

## `rename_team`

Change a team's slug. References to the old slug (issue assignees
`team:<slug>`, bookmarks) stop matching.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `team` | slug | required |
| `new_slug` | team slug, must differ from `team` | required |
| `format` | `"text"` \| `"json"` | `text` |

`TeamIn` has exactly one field (`slug`), so the request body is `{ slug:
new_slug }` — the complete resource, no read-first needed. A 500 gets the
same duplicate-slug hint as `create_team`.

## `delete_team`

Permanently delete a team. Its projects and members are not deleted; they
lose this team. Cannot be undone.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `team` | slug | **required**: a destructive call never uses a default |
| `confirm` | string | required; must equal `team` exactly |
| `format` | `"text"` \| `"json"` | `text` |

A `confirm` that differs from `team` is refused before GlitchTip is called.
Like `create_team`, a 404 here means the team was not found, or the caller's
organization role is below admin — the message says both.

## `add_member_to_team`

Add a member to a team. GlitchTip's `add` does not duplicate an existing
membership.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `member` | positive integer id (from `list_members`) or `"me"` | required |
| `team` | slug | required |
| `format` | `"text"` \| `"json"` | `text` |

Output is the team as GlitchTip re-reads it, so `isMember` and `memberCount`
reflect the change.

## `remove_member_from_team`

Remove a member from a team. Reversible with `add_member_to_team`.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `member` | positive integer id (from `list_members`) or `"me"` | required |
| `team` | slug | required |
| `format` | `"text"` \| `"json"` | `text` |

Output is the team as GlitchTip re-reads it.
