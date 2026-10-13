# Toolset `organizations`

Enabled by default (`GLITCHTIP_TOOLSETS` includes `organizations`). The three
mutating tools are registered only when `GLITCHTIP_READ_ONLY=false`; in
read-only mode they are absent from `tools/list` and calling one answers
`-32602 Unknown tool`.

`whoami` is not part of this toolset: it is always registered, whatever
`GLITCHTIP_TOOLSETS` says. It is listed here because it is the diagnosis tool
every toolset relies on.

Every tool accepts `format`: `text` (default, compact) or `json` (the same
projected fields as JSON, never the raw GlitchTip payload). Every result is
bounded by `MCP_RESPONSE_BUDGET`. All tools carry `openWorldHint: true`.

Scopes are those GlitchTip 6.2.6 checks (`@has_permission` in
`apps/organizations_ext/api.py` and `apps/environments/api.py`); a token that
has none of them gets a tool error naming the scopes it needs.

| Tool | GlitchTip endpoint | readOnly | destructive | idempotent | Scopes (any one) | Read-only mode |
|---|---|---|---|---|---|---|
| `whoami` | `GET /api/0/` | yes | no | yes | none | listed |
| `list_organizations` | `GET /api/0/organizations/` | yes | no | yes | `org:read`, `org:write`, `org:admin` | listed |
| `get_organization` | `GET /api/0/organizations/{organization_slug}/` | yes | no | yes | `org:read`, `org:write`, `org:admin` | listed |
| `list_organization_environments` | `GET /api/0/organizations/{organization_slug}/environments/` | yes | no | yes | `org:read`, `org:write`, `org:admin` | listed |
| `create_organization` | `POST /api/0/organizations/` | no | no | no | none; gated by the instance's organization-creation setting | hidden |
| `update_organization` | `PUT /api/0/organizations/{organization_slug}/` | no | no | yes | `org:write`, `org:admin` | hidden |
| `delete_organization` | `DELETE /api/0/organizations/{organization_slug}/` | no | yes | no | `org:admin` | hidden |

## `whoami`

Show which GlitchTip instance and user this server is acting as, the instance
version, and the scopes of the token in use. Call this first when a tool fails
with a permission error.

| Input | Type | Default |
|---|---|---|
| `format` | `"text"` \| `"json"` | `text` |

Output: instance URL, GlitchTip version, user (name and email, or anonymous),
token scopes, and the default organization. When no default organization can
be chosen it says `none — N visible, pass organization`; if that lookup fails
it says `unavailable (<reason>)`. In both cases `whoami` itself still succeeds.
The token is never part of the output, although GlitchTip returns it in the
API root.

## `list_organizations`

List organizations the token can see, with slug, name and creation date.

| Input | Type | Default |
|---|---|---|
| `cursor` | string | first page |
| `limit` | integer 1–100 | 50 |
| `format` | `"text"` \| `"json"` | `text` |

Text output is a table (`slug`, `name`, `created`) followed by
`next cursor: <cursor>` when there is another page. An empty result reads
`No organizations visible to this token.`

## `get_organization`

Get one organization: slug, name, its projects and teams (counts and slugs),
and the access scopes you hold in it.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization (see below) |
| `format` | `"text"` \| `"json"` | `text` |

## `list_organization_environments`

List environment names used in an organization's events.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `visibility` | `"visible"` \| `"hidden"` \| `"all"` | `visible` |
| `limit` | integer 1–100 | 50 |
| `cursor` | string | first page |
| `format` | `"text"` \| `"json"` | `text` |

## `create_organization`

Create an organization. Many instances disable this for non-superusers;
GlitchTip then answers 403.

| Input | Type | Default |
|---|---|---|
| `name` | string, 1–200 characters | required |
| `format` | `"text"` \| `"json"` | `text` |

## `update_organization`

Rename an organization. The name is the only field GlitchTip lets you change
(`OrganizationInSchema`); the slug stays.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `name` | string, 1–200 characters | required |
| `format` | `"text"` \| `"json"` | `text` |

## `delete_organization`

Permanently delete an organization and everything in it: projects, issues,
events, releases. Cannot be undone.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | **required**: a destructive call never uses a default |
| `confirm` | string | required; must equal `organization` exactly |
| `format` | `"text"` \| `"json"` | `text` |

A `confirm` that differs from `organization` is refused before GlitchTip is
called. Every destructive tool in this server follows this pattern.

## Default organization

`organization` is optional on every non-destructive tool (D-11). When it is
omitted, the server uses, in order: the `X-GlitchTip-Org` header (HTTP mode),
`GLITCHTIP_DEFAULT_ORG`, or the only organization the token can see. That last
lookup is cached in memory for five minutes per instance and token. When the
token sees several organizations, the tool error lists their slugs and asks
for `organization`.
