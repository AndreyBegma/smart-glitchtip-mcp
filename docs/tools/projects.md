# Toolset `projects`

Enabled by default (`GLITCHTIP_TOOLSETS` includes `projects`). The nine mutating
tools are registered only when `GLITCHTIP_READ_ONLY=false`; in read-only mode
they are absent from `tools/list` and calling one answers `-32602 Unknown
tool`.

Every tool accepts `format`: `text` (default, compact) or `json` (the same
projected fields as JSON, never the raw GlitchTip payload). Every result is
bounded by `MCP_RESPONSE_BUDGET`. All tools carry `openWorldHint: true`.
Project names and slugs are operator-controlled, not event-derived, so no
untrusted-content fence applies to them.

Scopes are those GlitchTip 6.2.6 checks (`@has_permission` in
`apps/projects/api.py`, `apps/environments/api.py` and `apps/teams/api.py`); a
token that has none of them gets a tool error naming the scopes it needs.

| Tool | GlitchTip endpoint | readOnly | destructive | idempotent | Scopes (any one) | Read-only mode |
|---|---|---|---|---|---|---|
| `list_projects` | `GET /api/0/organizations/{organization_slug}/projects/` | yes | no | yes | `project:read` | listed |
| `get_project` | `GET /api/0/projects/{organization_slug}/{project_slug}/` | yes | no | yes | `project:read`, `project:write`, `project:admin` | listed |
| `list_team_projects` | `GET /api/0/teams/{organization_slug}/{team_slug}/projects/` | yes | no | yes | `project:read` | listed |
| `list_project_keys` | `GET /api/0/projects/{organization_slug}/{project_slug}/keys/` | yes | no | yes | `project:read`, `project:write`, `project:admin` | listed |
| `get_project_key` | `GET /api/0/projects/{organization_slug}/{project_slug}/keys/{key_id}/` | yes | no | yes | `project:read`, `project:write`, `project:admin` | listed |
| `list_project_environments` | `GET /api/0/projects/{organization_slug}/{project_slug}/environments/` | yes | no | yes | `project:read`, `project:write`, `project:admin` | listed |
| `list_project_teams` | `GET /api/0/projects/{organization_slug}/{project_slug}/teams/` | yes | no | yes | `project:read` | listed |
| `create_project` | `POST /api/0/teams/{organization_slug}/{team_slug}/projects/` | no | no | no | `project:write`, `project:admin` | hidden |
| `update_project` | `PUT /api/0/projects/{organization_slug}/{project_slug}/` | no | no | yes | `project:write`, `project:admin` | hidden |
| `delete_project` | `DELETE /api/0/projects/{organization_slug}/{project_slug}/` | no | yes | no | `project:admin` | hidden |
| `create_project_key` | `POST /api/0/projects/{organization_slug}/{project_slug}/keys/` | no | no | no | `project:write`, `project:admin` | hidden |
| `update_project_key` | `PUT /api/0/projects/{organization_slug}/{project_slug}/keys/{key_id}/` | no | no | yes | `project:write`, `project:admin` | hidden |
| `delete_project_key` | `DELETE /api/0/projects/{organization_slug}/{project_slug}/keys/{key_id}/` | no | yes | no | `project:admin` | hidden |
| `set_project_environment_visibility` | `PUT /api/0/projects/{organization_slug}/{project_slug}/environments/{name}/` | no | no | yes | `project:write`, `project:admin` | hidden |
| `add_team_to_project` | `POST /api/0/projects/{organization_slug}/{project_slug}/teams/{team_slug}/` | no | no | yes | `project:admin` (see Upstream quirk) | hidden |
| `remove_team_from_project` | `DELETE /api/0/projects/{organization_slug}/{project_slug}/teams/{team_slug}/` | no | no | yes | `project:admin` (see Upstream quirk) | hidden |

## `list_projects`

List projects in an organization, with slug, name, platform, team slugs and
when the first event arrived.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `query` | string | none — GlitchTip project search, e.g. `!team:<slug>` for projects not in a team |
| `limit` | integer 1–100 | 50 |
| `cursor` | string | first page |
| `format` | `"text"` \| `"json"` | `text` |

An empty result reads `No projects in this organization.`; a project with no
events shows `no events yet` instead of a date.

## `get_project`

Get one project: slug, name, id, platform, created, first event, event
throttle rate, IP scrubbing, public/bookmarked flags and the organization it
belongs to.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `format` | `"text"` \| `"json"` | `text` |

## `list_team_projects`

List a team's projects.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `team` | slug | required |
| `limit` | integer 1–100 | 50 |
| `cursor` | string | first page |
| `format` | `"text"` \| `"json"` | `text` |

## `list_project_keys`

List a project's client keys (DSNs) — what an application's Sentry SDK is
configured with. The output shows `dsn.public` and `dsn.security`; the
deprecated `dsn.secret` (which duplicates `public`) is never shown.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `limit` | integer 1–100 | 50 |
| `cursor` | string | first page |
| `format` | `"text"` \| `"json"` | `text` |

## `get_project_key`

Get one client key (DSN) of a project.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `key_id` | uuid | required |
| `format` | `"text"` \| `"json"` | `text` |

## `list_project_environments`

List a project's environments (e.g. production, staging) and whether each is
hidden.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `visibility` | `"visible"` \| `"hidden"` \| `"all"` | `visible` |
| `limit` | integer 1–100 | 50 |
| `cursor` | string | first page |
| `format` | `"text"` \| `"json"` | `text` |

## `list_project_teams`

List the teams attached to a project.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `limit` | integer 1–100 | 50 |
| `cursor` | string | first page |
| `format` | `"text"` \| `"json"` | `text` |

## `create_project`

Create a project owned by a team (GlitchTip creates projects only under a
team), then fetch its default DSN in the same result. If that follow-up call
fails, the tool still succeeds — the project exists — with a
`DSN fetch failed: <reason>; call list_project_keys(project)` line instead of
the DSN.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `team` | slug | required |
| `name` | string | required |
| `platform` | string | none, e.g. `python`, `javascript-react` |
| `slug` | slug | none — GlitchTip derives one from the name |
| `event_throttle_rate` | integer 0–100 | none |
| `format` | `"text"` \| `"json"` | `text` |

## `update_project`

Change a project's name, platform, slug or event throttle rate. GlitchTip's
`PUT` is a full replace, so this tool reads the project first and sends the
complete body with the requested changes merged in — an unspecified field is
always re-sent unchanged, never dropped. At least one of `name`, `platform`,
`new_slug` or `event_throttle_rate` is required.

If GlitchTip's read leaves out a field the tool must re-send (`name`, `slug`,
`platform`, `eventThrottleRate`), or carries it with the wrong type, and the
caller did not supply it, the call is refused with nothing written:
"GlitchTip's response did not include `<field>` …; pass `<parameter>`
explicitly or retry" (AGENTS.md rule 15). A `null` in the read is re-sent as
`null` (except `name`, which must be text).

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `name` | string | keeps its current value |
| `platform` | string | keeps its current value |
| `new_slug` | slug | keeps its current value |
| `event_throttle_rate` | integer 0–100 | keeps its current value |
| `format` | `"text"` \| `"json"` | `text` |

## `delete_project`

Permanently delete a project with all its issues, events and keys.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `confirm` | string | required; must equal `project` exactly |
| `format` | `"text"` \| `"json"` | `text` |

## `create_project_key`

Create a client key (DSN) for a project. `label` maps to the request body's
`name` field (`ProjectKeyIn` has no `label`; GlitchTip's response aliases
`name` as `label`).

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `label` | string | none |
| `rate_limit` | `{ window: seconds, count }` | none |
| `format` | `"text"` \| `"json"` | `text` |

## `update_project_key`

Change a client key's label or rate limit. Same full-replace rule as
`update_project`: the tool reads the key first and re-sends its complete body
with the requested change merged in. `rate_limit: null` clears the rate
limit; omitting it keeps the current one.

The current label is the first of `name` and `label` (GlitchTip's canonical
field) that is text, else `null` if either is `null`. A read with neither
usable, and no `label` given — or with `rateLimit` missing or not
`{ window, count }`/`null`, and no `rate_limit` given — is refused with
nothing written.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `key_id` | uuid | required |
| `label` | string | keeps its current value |
| `rate_limit` | `{ window: seconds, count } \| null` | keeps its current value |
| `format` | `"text"` \| `"json"` | `text` |

## `delete_project_key`

Delete a client key; applications using this DSN stop being able to send
events.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `key_id` | uuid | required |
| `confirm` | string | required; must equal `key_id` exactly |
| `format` | `"text"` \| `"json"` | `text` |

## `set_project_environment_visibility`

Hide or show one of a project's environments.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `environment` | string | required |
| `hidden` | boolean | required |
| `format` | `"text"` \| `"json"` | `text` |

## `add_team_to_project`

Attach a team to a project, granting its members access.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `team` | slug | required |
| `format` | `"text"` \| `"json"` | `text` |

## `remove_team_from_project`

Detach a team from a project. Reversible — attaching it again undoes it.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `team` | slug | required |
| `format` | `"text"` \| `"json"` | `text` |

## Upstream quirk: `add_team_to_project` / `remove_team_from_project`

GlitchTip 6.2.6 decorates these two routes with
`has_permission(["project.write", "project:admin"])` — `project.write` with a
dot, which matches no real token scope. In practice only `project:admin`
works; a 403 from either tool names `project:admin` and mentions this quirk in
one sentence. An upstream report is a follow-up, not part of this toolset.

## Default organization

`organization` is optional on every tool in this toolset, including the
destructive ones (`delete_project`, `delete_project_key`): the destructive
target is `project` or `key_id`, both required with a matching `confirm`, so
the organization does not need the same guard `delete_organization` uses in
the `organizations` toolset. When `organization` is omitted, the server uses,
in order: the `X-GlitchTip-Org` header (HTTP mode), `GLITCHTIP_DEFAULT_ORG`, or
the only organization the token can see.
