# GlitchTip 6.2.6 API — endpoint extract for MCP tool specs

Source: `docs/reference/glitchtip-openapi.json` (OpenAPI 3.1.0, django-ninja, 114 paths, 189 schemas, `servers: []`).
Notation: `*` = required. `T|null` = nullable/optional. All array query params use OpenAPI default `style=form, explode=true` → `?project=1&project=2`.
Security column: `T/S` = `TokenAuth` (HTTP bearer) OR `SessionAuth` (cookie `sessionid`); `none` = no security declared.
Only success responses are documented (200/201/202/204). **No 4xx/5xx responses and no response headers are documented anywhere.**

## E. Cross-cutting: security, scopes, pagination

| Item | What the spec says |
|---|---|
| Security schemes | `TokenAuth`: `{type: http, scheme: bearer}`; `SessionAuth`: `{type: apiKey, in: cookie, name: sessionid}`. No global `security`; set per-operation. |
| Scopes | **Not modelled in securitySchemes** (bearer, no OAuth flows). Scope vocabulary appears only as data: `OrganizationDetailSchema.access` enum = `org:read org:write org:admin org:integrations member:read member:write member:admin team:read team:write team:admin project:read project:write project:admin project:releases event:read event:write event:admin`. `APITokenSchema.scopes: array[string]`, but `APITokenIn.scopes: integer` (bitfield on create). No per-endpoint required-scope docs. |
| Token management | `/api/0/api-tokens/` GET/POST, `/api-tokens/{token_id}/` DELETE — **SessionAuth only** (a bearer token cannot manage tokens). |
| Pagination params | `limit: integer|null` ("Number of results to return per page."), `cursor: string|null` ("The pagination cursor value."). No min/max/default declared. Present on 35 list ops. |
| Pagination response | **Not described.** No response headers (no `Link`, no `X-Hits`), responses are bare JSON arrays (no envelope with `next`). Next-cursor must come from the `Link` header (Sentry-style, undocumented here). |
| Unpaginated lists | `issues/{id}/tags/`, `issues/{id}/commits/`, `issues-stats/` have no `limit`/`cursor`. |

## A. Organizations + root

| Method | Path | operationId | Params | Body | Response | Sec |
|---|---|---|---|---|---|---|
| GET | `/api/0/` | `glitchtip_api_api_api_root` | — | — | 200 `APIRootSchema` | none |
| GET | `/api/0/organizations/` | `apps_organizations_ext_api_list_organizations` | q: `owner` bool\|null, `query` str\|null, `sortBy` str\|null, `limit`, `cursor` | — | 200 `OrganizationSchema[]` | T/S |
| POST | `/api/0/organizations/` | `apps_organizations_ext_api_create_organization` | — | `OrganizationInSchema` | 201 `OrganizationDetailSchema` | T/S |
| GET | `/api/0/organizations/{organization_slug}/` | `apps_organizations_ext_api_get_organization` | p: `organization_slug`* str | — | 200 `OrganizationDetailSchema` | T/S |
| PUT | `/api/0/organizations/{organization_slug}/` | `apps_organizations_ext_api_update_organization` | p: `organization_slug`* | `OrganizationInSchema` | 200 `OrganizationDetailSchema` | T/S |
| DELETE | `/api/0/organizations/{organization_slug}/` | `apps_organizations_ext_api_delete_organization` | p: `organization_slug`* | — | 204 | T/S |
| GET | `/api/0/organizations/{organization_slug}/environments/` | `apps_environments_api_list_environments` | p: `organization_slug`*; q: `visibility` enum `all\|hidden\|visible` default `visible`, `limit`, `cursor` | — | 200 `EnvironmentSchema[]` | T/S |

Create org description: first org on a server always allowed; afterwards `ENABLE_OPEN_USER_REGISTRATION` checked; superusers always allowed.

**Schemas**

| Schema | Fields |
|---|---|
| `APIRootSchema` | `version`* str, `user`* `UserSchema\|null`, `auth`* `APITokenSchema\|null` — "gives information about the server and current user". Declared with no security, so it answers anonymously with `user`/`auth` = null; with a bearer token, `auth` carries the token's `scopes`. Good whoami / token-scope probe. |
| `UserSchema` | `id`* str, `username`* email, `email`* email, `name` str\|null, `dateJoined`* dt, `lastLogin` dt\|null, `isSuperuser` bool, `isActive` bool, `hasPasswordAuth`* bool, `identities`* `SocialAccountSchema[]`, `options`* `UserOptions{timezone, stacktraceOrder:int, language, clock24Hours:bool, preferredTheme}` |
| `APITokenSchema` | `id`* int, `label`* str, `scopes`* str[], `token`* str, `created`* dt |
| `OrganizationInSchema` | `name`* str (only writable field; PUT can only rename) |
| `OrganizationSchema` | `id`* str, `slug`* str, `name`* str, `dateCreated`* dt, `status` {id,name} default active, `avatar` {avatarType, avatarUuid}, `isEarlyAdopter` bool, `require2fa` bool, `isAcceptingEvents` bool, `eventThrottleRate` int |
| `OrganizationDetailSchema` | `OrganizationSchema` + `projects`* `ProjectTeamSchema[]`, `teams`* `TeamSchema[]`, `access`* scope-enum[] (see E), `openMembership` bool |
| `EnvironmentSchema` | `id` int\|null, `name`* str |

## B. Issues

Org-scoped and non-org-scoped variants share schemas; `issue_id` is **integer** in paths while `IssueSchema.id` is a **string**.

| Method | Path | operationId | Params | Body | Response |
|---|---|---|---|---|---|
| GET | `/api/0/organizations/{org}/issues/` | `apps_issue_events_api_issues_list_issues` | p: `organization_slug`*; q: see "Issue list query" | — | 200 `IssueSchema[]` |
| PUT | `/api/0/organizations/{org}/issues/` | `apps_issue_events_api_issues_update_issues` | p: org*; q: `id`, `start`, `end`, `project`, `environment`, `query` (no sort/limit/cursor) | `UpdateIssueSchema` | 200 `UpdateIssueSchema` (echo) |
| DELETE | `/api/0/organizations/{org}/issues/` | `apps_issue_events_api_issues_delete_issues` | same filter query as bulk PUT | — | **200 `UpdateIssueSchema`** (odd: not 204) |
| GET | `/api/0/projects/{org}/{project_slug}/issues/` | `apps_issue_events_api_issues_list_project_issues` | p: org*, `project_slug`*; q: same as org list (incl. redundant `project` int[]) | — | 200 `IssueSchema[]` |
| GET | `/api/0/organizations/{org}/issues-stats/` | `apps_issue_events_api_issues_issue_stats` | p: org*; q: `groups`* int[] (required), `statsPeriod` enum `14d\|24h` default `24h` | — | 200 `IssueStatsResponse[]` |
| GET | `/api/0/issues/{issue_id}/` | `..._issues_get_issue` | p: `issue_id`* int | — | 200 `IssueDetailSchema` |
| GET | `/api/0/organizations/{org}/issues/{issue_id}/` | `..._issues_get_organization_issue` | p: org*, issue_id* | — | 200 `IssueDetailSchema` |
| PUT | `/api/0/issues/{issue_id}/` | `..._issues_update_issue` | p: issue_id* | `UpdateIssueSchema` | 200 `IssueDetailSchema` |
| PUT | `/api/0/organizations/{org}/issues/{issue_id}/` | `..._issues_update_organization_issue` | p: org*, issue_id* | `UpdateIssueSchema` | 200 `IssueDetailSchema` |
| DELETE | `/api/0/issues/{issue_id}/` | `..._issues_delete_issue` | p: issue_id* | — | 204 |
| DELETE | `/api/0/organizations/{org}/issues/{issue_id}/` | `..._issues_delete_organization_issue` | p: org*, issue_id* | — | 204 |
| GET | `/api/0/issues/{issue_id}/commits/` | `..._issues_list_issue_commits` | p: issue_id* (no paging) | — | 200 `CommitSchema[]` — commits of the release where the issue first appeared |
| GET | `/api/0/organizations/{org}/issues/{issue_id}/commits/` | `..._issues_list_organization_issue_commits` | p: org*, issue_id* | — | 200 `CommitSchema[]` |
| GET | `/api/0/issues/{issue_id}/tags/` | `..._issues_list_issue_tags` | p: issue_id*; q: `key` str\|null (no paging) | — | 200 `IssueTagSchema[]` |
| GET | `/api/0/organizations/{org}/issues/{issue_id}/tags/` | `..._issues_list_organization_issue_tags` | p: org*, issue_id*; q: `key` | — | 200 `IssueTagSchema[]` |
| GET | `/api/0/issues/{issue_id}/comments/` | `apps_issue_events_api_comments_list_comments` | p: issue_id*; q: limit, cursor | — | 200 `CommentSchema[]` |
| POST | `/api/0/issues/{issue_id}/comments/` | `..._comments_add_comment` | p: issue_id* | `PostCommentSchema` | 201 `CommentSchema` |
| PUT | `/api/0/issues/{issue_id}/comments/{comment_id}/` | `..._comments_update_comment` | p: issue_id*, `comment_id`* int | `PostCommentSchema` | 200 `CommentSchema` |
| DELETE | `/api/0/issues/{issue_id}/comments/{comment_id}/` | `..._comments_delete_comment` | p: issue_id*, comment_id* | — | 204 |
| GET/POST | `/api/0/organizations/{org}/issues/{issue_id}/comments/` | `..._comments_list_organization_comments` / `..._add_organization_comment` | as above + org* | as above | as above |
| PUT/DELETE | `/api/0/organizations/{org}/issues/{issue_id}/comments/{comment_id}/` | `..._update_organization_comment` / `..._delete_organization_comment` | as above + org* | as above | as above |
| GET | `/api/0/issues/{issue_id}/user-reports/` | `apps_issue_events_api_user_reports_list_user_reports` | p: issue_id*; q: limit, cursor | — | 200 `UserReportSchema[]` |
| GET | `/api/0/organizations/{org}/issues/{issue_id}/user-reports/` | `..._list_organization_user_reports` | + org* | — | 200 `UserReportSchema[]` |
| GET | `/api/0/organizations/{org}/issues/{issue_id}/hashes/` | `apps_issue_events_api_hashes_list_issue_hashes` | p: org*, issue_id*; q: limit, cursor | — | 200 `IssueHashSchema[]` |
| DELETE | `/api/0/organizations/{org}/issues/{issue_id}/hashes/` | `..._hashes_delete_hash` | p: org*, issue_id*; q: `id`* uuid[] | — | **202** (no body) — unmerge/split hashes |

All: security T/S.

**Issue list query** (org list and project list; bulk PUT/DELETE take the first six only — the `IssueFilters` shape)

| Param | Type | Enum / default | Notes |
|---|---|---|---|
| `id` | int[]\|null | — | explicit issue ids |
| `start` | date-time\|null | — | |
| `end` | date-time\|null | — | |
| `project` | int[]\|null | — | numeric project ids, not slugs |
| `environment` | str[]\|null | — | |
| `query` | str\|null | — | **search syntax not documented** (Sentry-style `is:unresolved`, free text, `key:value` tags presumed; only documented example of the syntax anywhere is `?query=!team:slug` on the org projects list) |
| `sort` | str | `last_seen first_seen count priority` and `-` variants; default `-last_seen` | list only |
| `limit`, `cursor` | int\|null, str\|null | — | list only |

No `status` query param exists — status filtering must go through `query` (e.g. `is:unresolved`).

**Bulk semantics:** bulk PUT/DELETE select issues **via the query string** (`id`/`project`/`environment`/`query`/`start`/`end`), not the body. The body of PUT is the same `UpdateIssueSchema` as single update. A bulk call with no filters would match all org issues — spec has no guard.

**Schemas**

| Schema | Fields |
|---|---|
| `UpdateIssueSchema` | all optional: `status` enum `unresolved\|resolved\|ignored`\|null; `statusDetails` `{inRelease: str\|null, inNextRelease: bool\|null}`\|null (no ignore-duration/count fields); `merge` int\|null (format/semantics undocumented); `assignedTo` str\|null (format undocumented; response actor has `type user\|team` + `id`) |
| `IssueSchema` | `id`* str, `shortId`* str, `title`* str, `culprit` str\|null, `count`* **str**, `userCount` int, `numComments`* int, `type`* enum `default\|error\|csp`, `level`* enum `sample\|debug\|info\|warning\|error\|fatal`, `status`* enum `unresolved\|resolved\|ignored`, `statusDetails` obj\<str\>\|null, `metadata`* obj, `project`* `ProjectReference{id* str, name* str, slug, platform}`, `firstSeen`* dt, `lastSeen`* dt, `firstRelease`/`lastRelease` `IssueReleaseSchema{version*, shortVersion*, dateCreated*, dateReleased}`\|null, `assignedTo` `IssueActorSchema{type* user\|team, id* str, name* str, username, email, slug}`\|null, `stats` `{ "24h": [[ts, n]] }`, `logger`, `permalink` (default "Not implemented"), `shareId`, `subscriptionDetails`, `matchingEventId` |
| `IssueDetailSchema` | `IssueSchema` + `userReportCount`* int |
| `IssueStatsResponse` | `id`* str, `count`* str, `userCount`* int, `firstSeen`* str, `lastSeen`* str, `isUnhandled`* bool, `stats`* `{24h: int[][]\|null, 14d: int[][]\|null}` |
| `IssueTagSchema` | `key`* str, `name`* str, `totalValues`* int, `uniqueValues`* int, `topValues`* `{key*, name*, value*, count* int}[]` |
| `CommentSchema` | `id` int\|null, `data`* obj\<str\> (e.g. `{"text": "..."}` — key not specified), `type` default `note`, `dateCreated`* dt, `user`* `{id*, email*}`\|null |
| `PostCommentSchema` | `data`* obj\<str\> |
| `UserReportSchema` | `id` int\|null, `eventID`* str, `event`* obj\<str\>, `name`* str, `email`* str, `comments`* str, `user` str\|null, `dateCreated`* dt |
| `IssueHashSchema` | `id`* str, `latestEvent`* `IssueEventSchema`\|null |
| `CommitSchema` | `id`* str, `message` str, `dateCreated` str\|null, `authorName`, `authorEmail` |

## C. Events

| Method | Path | operationId | Params | Response |
|---|---|---|---|---|
| GET | `/api/0/issues/{issue_id}/events/` | `apps_issue_events_api_events_list_issue_event` | p: issue_id* int; q: limit, cursor | 200 `IssueEventSchema[]` |
| GET | `/api/0/organizations/{org}/issues/{issue_id}/events/` | `..._events_list_organization_issue_event` | + org* | 200 `IssueEventSchema[]` |
| GET | `/api/0/issues/{issue_id}/events/latest/` | `..._events_get_latest_issue_event` | p: issue_id* | 200 `IssueEventDetailSchema` |
| GET | `/api/0/organizations/{org}/issues/{issue_id}/events/latest/` | `..._events_get_organization_latest_issue_event` | + org* | 200 `IssueEventDetailSchema` |
| GET | `/api/0/issues/{issue_id}/events/{event_id}/` | `..._events_get_issue_event` | p: issue_id*, `event_id`* uuid | 200 `IssueEventDetailSchema` |
| GET | `/api/0/organizations/{org}/issues/{issue_id}/events/{event_id}/` | `..._events_get_organization_issue_event` | + org* | 200 `IssueEventDetailSchema` |
| GET | `/api/0/organizations/{org}/issues/{issue_id}/events/{event_id}/json/` | `..._events_get_event_json` | p: org*, issue_id*, event_id* uuid | 200 `IssueEventJsonSchema` (org-scoped only) |
| GET | `/api/0/projects/{org}/{project_slug}/events/` | `..._events_list_project_issue_event` | p: org*, project_slug*; q: limit, cursor (no filters) | 200 `IssueEventSchema[]` |
| GET | `/api/0/projects/{org}/{project_slug}/events/{event_id}/` | `..._events_get_project_issue_event` | + event_id* uuid | 200 `IssueEventDetailSchema` |

All: security T/S. No query/environment/time filters on any events list.

**Schemas**

| Schema | Fields |
|---|---|
| `IssueEventSchema` | `id`* str, `eventID`* str, `projectID`* int, `groupID`* str, `title`* str, `message`* str, `type`* str, `platform`, `culprit`, `dist`, `dateCreated`* dt, `dateReceived`* dt, `metadata` obj\<str\>, `tags` `object<str\|null>[]` (list of `{key, value}`-like dicts, keys unspecified), `entries` (see below), `contexts` map name → oneOf(Device/OS/Runtime/App/Browser/GPU/State/Culture/CloudResource/Trace/Replay/Response Context), `context` obj (extra), `user` **untyped (`any`)**, `sdk` obj, `packages` obj\<str\>, `errors` `EventProcessingError{type*, name, value}[]` |
| `IssueEventDetailSchema` | `IssueEventSchema` + `userReport`* `UserReportSchema`\|null, `nextEventID` str\|null, `previousEventID` str\|null |
| `IssueEventJsonSchema` (raw Sentry-legacy) | `event_id`* str, `timestamp`* number, `datetime`* dt, `project`* int, `level`* str\|null, `type`* str\|null, `title`* str, `transaction`* str, `platform`, `environment` str\|null, `tags`* obj, `exception` any, `breadcrumbs` any, `request` any, `contexts` obj, `extra` obj, `modules` obj\<str\>, `sdk` obj, `user` `EventUser{id, username, email, ip_address, data, geo{city, country_code, region, subdivision}}`, `hashes` str[], `errors` |

**`entries[]`** — discriminated by `type`:

| type | Schema | `data` |
|---|---|---|
| `exception` | `ExceptionEntry` | **untyped `object`** — frames not modelled here |
| `message` | `MessageEntry` | untyped `object` |
| `csp` | `CSPEntry` | untyped `object` |
| `breadcrumbs` | `BreadcrumbsEntry` | `{values: APIEventBreadcrumb[]}` (map of arrays): `type` default "default", `category`, `message`, `data` obj, `level` enum `fatal\|error\|warning\|info\|debug` default info, `timestamp` dt, `event_id` |
| `request` | `RequestEntry` | `Request`: `url`, `method`, `protocol`, `fragment`, `query` [[k,v]], `headers` [[k,v]], `cookies` str\|[[k,v]]\|obj, `data` any, `env` obj, `bodySize` int, `apiTarget`, `inferredContentType`* str\|null |

Frame shape exists only in **ingest** schemas (`IngestEventException` → `StackTrace{frames*, registers}` → `StackTraceFrame`), not referenced by any read endpoint. Presumably the stored exception data mirrors it: `values[]{type, value, module, thread_id, mechanism{type*, handled, synthetic, ...}, stacktrace{frames[]}, raw_stacktrace}`. `StackTraceFrame`: `filename, function, raw_function, module, lineno, colno, abs_path, context_line, pre_context[], post_context[], in_app bool, vars obj, package, platform, symbol, instruction_addr, image_addr, source_link, stack_start, lock, addr_mode, symbol_addr, function_id` (all nullable).

**Release on event:** no `release` field on `IssueEventSchema`/`IssueEventDetailSchema`/`IssueEventJsonSchema` — only available via `tags` (presumably key `release`) or issue `firstRelease`/`lastRelease`. `environment` is only a top-level field on the JSON variant.

## D. Projects

| Method | Path | operationId | Params | Body | Response |
|---|---|---|---|---|---|
| GET | `/api/0/projects/` | `apps_projects_api_list_projects` | q: limit, cursor | — | 200 `ProjectOrganizationSchema[]` (all projects the user can access) |
| GET | `/api/0/organizations/{org}/projects/` | `apps_projects_api_list_organization_projects` | p: org*; q: `query` str\|null (e.g. `!team:burke-software`), limit, cursor | — | 200 `ProjectTeamSchema[]` |
| GET | `/api/0/projects/{org}/{project_slug}/` | `apps_projects_api_get_project` | p: org*, project_slug* | — | 200 `ProjectOrganizationSchema` |
| PUT | `/api/0/projects/{org}/{project_slug}/` | `apps_projects_api_update_project` | p: org*, project_slug* | `ProjectIn` | 200 `ProjectOrganizationSchema` |
| DELETE | `/api/0/projects/{org}/{project_slug}/` | `apps_projects_api_delete_project` | p: org*, project_slug* | — | 204 |
| GET | `/api/0/teams/{org}/{team_slug}/projects/` | `apps_projects_api_list_team_projects` | p: org*, `team_slug`*; q: limit, cursor | — | 200 `ProjectSchema[]` |
| POST | `/api/0/teams/{org}/{team_slug}/projects/` | `apps_projects_api_create_project` | p: org*, team_slug* | `ProjectIn` | 201 `ProjectSchema` |
| GET | `/api/0/projects/{org}/{project_slug}/keys/` | `apps_projects_api_list_project_keys` | p: org*, project_slug*; q: `status` str\|null (values undocumented), limit, cursor | — | 200 `ProjectKeySchema[]` |
| POST | `/api/0/projects/{org}/{project_slug}/keys/` | `apps_projects_api_create_project_key` | p: org*, project_slug* | `ProjectKeyIn` | 201 `ProjectKeySchema` ("Rate limiting not implemented") |
| GET | `/api/0/projects/{org}/{project_slug}/keys/{key_id}/` | `apps_projects_api_get_project_key` | + `key_id`* uuid | — | 200 `ProjectKeySchema` |
| PUT | `/api/0/projects/{org}/{project_slug}/keys/{key_id}/` | `apps_projects_api_update_project_key` | + key_id* | `ProjectKeyIn` | 200 `ProjectKeySchema` |
| DELETE | `/api/0/projects/{org}/{project_slug}/keys/{key_id}/` | `apps_projects_api_delete_project_key` | + key_id* | — | 204 |
| GET | `/api/0/projects/{org}/{project_slug}/environments/` | `apps_environments_api_list_environment_projects` | q: `visibility` enum `all\|hidden\|visible` default `visible`, limit, cursor | — | 200 `EnvironmentProjectSchema[]` |
| PUT | `/api/0/projects/{org}/{project_slug}/environments/{name}/` | `apps_environments_api_update_environment_project` | + `name`* str | `EnvironmentProjectIn` | 200 `EnvironmentProjectSchema` |
| GET | `/api/0/projects/{org}/{project_slug}/teams/` | `apps_teams_api_list_project_teams` | q: limit, cursor | — | 200 `TeamSchema[]` |
| POST | `/api/0/projects/{org}/{project_slug}/teams/{team_slug}/` | `apps_teams_api_add_team_to_project` | + team_slug* | — (no body) | 201 `ProjectTeamSchema` |
| DELETE | `/api/0/projects/{org}/{project_slug}/teams/{team_slug}/` | `apps_teams_api_delete_team_from_project` | + team_slug* | — | **200 `ProjectTeamSchema`** (not 204) |

All: security T/S. No POST under `/organizations/{org}/projects/` — project creation is team-scoped only.

**Schemas**

| Schema | Fields |
|---|---|
| `ProjectIn` (create & update) | `name`* str, `slug` str\|null, `platform` str\|null, `eventThrottleRate` int\|null — PUT requires `name` (full-replace semantics) |
| `ProjectSchema` | `id`* str, `name`* str, `slug` str\|null, `platform`, `dateCreated`* dt, `firstEvent` dt\|null, `isMember`* bool, `scrubIPAddresses`* bool, `hasAccess`, `isBookmarked`, `isInternal`, `isPublic` bool, `color`, `features` str[], `avatar`, `eventThrottleRate` int |
| `ProjectOrganizationSchema` | `ProjectSchema` + `organization`* `OrganizationSchema` |
| `ProjectTeamSchema` | `ProjectSchema` + `teams`* `TeamSlugSchema{id*, slug*}[]` |
| `TeamSchema` | `id`* str, `slug`* str, `dateCreated`* dt, `isMember`* bool, `memberCount`* int |
| `ProjectKeyIn` | `name` str\|null, `rateLimit` `{window* int, count* int}`\|null |
| `ProjectKeySchema` | `id`* uuid, `name` str\|null, `label`* str\|null, `public`* uuid, `projectID`* int, `dateCreated`* dt, `dsn`* obj\<str\> (keys e.g. `public`, `secret`, `security`… — not enumerated), `rateLimit` |
| `EnvironmentProjectSchema` | `id` int\|null, `name`* str, `isHidden` bool default false |
| `EnvironmentProjectIn` | `name`* str, `isHidden`* bool |

## Org-scoped vs non-org-scoped issue path parity

| Capability | `/api/0/issues/{id}/…` | `/api/0/organizations/{org}/issues/{id}/…` |
|---|---|---|
| get / update / delete issue | yes | yes |
| events list / latest / by id | yes | yes |
| event raw `json/` | **no** | yes |
| comments CRUD | yes | yes |
| tags, commits, user-reports | yes | yes |
| hashes list / delete (unmerge) | **no** | yes |
| list / bulk update / bulk delete | n/a (no `/api/0/issues/` list) | `/organizations/{org}/issues/` only (+ project-scoped list, GET only) |

---

## Facts from the GlitchTip 6.2.6 source (not in the OpenAPI snapshot)

Read from `glitchtip-backend` at tag `v6.2.6` (https://gitlab.com/glitchtip/glitchtip-backend/-/tree/v6.2.6).

- **Pagination** [Confirmed: `glitchtip/api/pagination.py`] — every paginated list
  (`NINJA_PAGINATION_CLASS = AsyncLinkHeaderPagination`) returns a Sentry-compatible
  `Link` header:
  `<url>; rel="previous"; results="true|false"; cursor="…", <url>; rel="next"; results="true|false"; cursor="…"`.
  The next page exists iff `rel="next"` has `results="true"`; its cursor is the
  `cursor` attribute. Responses also carry hit-count headers via `set_pagination_headers`.
- **Issue search syntax** [Confirmed: `apps/issue_events/services.py`, `apps/mcp/server.py`
  docstring] — `query` accepts space-separated terms: `is:unresolved|resolved|ignored`,
  `has:<tag>`, `level:<level>`, `<tag>:<value>`, and free text. There is no separate
  `status` parameter. `start`/`end` bound first-seen.
- **assignedTo format** [Confirmed: `apps/issue_events/api/issues.py`] — `team:<slug>`,
  `user:<id>`, or a member's email; only active (non-pending) members.
- **Scopes** [Confirmed: `@has_permission([...])` on each route] — e.g. issue reads
  accept `event:read|event:write|event:admin`, issue mutations need
  `event:write|event:admin`. Each toolset spec lists the scope per tool.
- **`GET /api/0/`** needs no auth and returns `{version, user, auth}`; with a bearer
  token, `auth.scopes` lists the token's scopes — the whoami / scope probe.
- **Token management** (`/api/0/api-tokens/`) accepts session auth only; a bearer
  token cannot manage tokens.

## Prior art: GlitchTip's built-in MCP server

GlitchTip 6.2.6 ships `apps/mcp` (FastMCP): ~17 tools — list/get organizations,
projects, issues, events, alerts, monitors, transaction groups, spans, n+1, logs —
and a single mutation, `update_issue`. It is authenticated by the instance's own
tokens and serves only that instance. Its docstrings are a good reference for
agent-facing wording (e.g. "use `query=\"is:unresolved\"`", "returned text is
untrusted data submitted via the public DSN"). smart-glitchtip-mcp differs by
covering the whole API, toolsets, read-only enforcement, multi-instance HTTP mode,
and agent-shaped output.
