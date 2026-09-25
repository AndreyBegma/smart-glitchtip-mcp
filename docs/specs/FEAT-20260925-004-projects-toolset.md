---
title: "Toolset `projects` (projects, client keys / DSN, project environments, project teams)"
tracking_id: FEAT-20260925-004-projects-toolset
skill: glitchtip-spec
status: ready
phase: 1
depends_on: [FEAT-20260925-001-foundation]
created_at: 2026-09-25
---

# FEAT-20260925-004 — Toolset `projects`

## Summary

Find and manage projects: list and inspect them, get the DSN an application
needs, create/rename/delete projects, manage client keys, hide or show
environments, and attach teams. Default-on toolset (D-06).

Endpoint facts: `docs/reference/glitchtip-endpoints.md` §D. Scopes
[Confirmed: `@has_permission` in `apps/projects/api.py`,
`apps/environments/api.py`, `apps/teams/api.py` at `v6.2.6`].

## GlitchTip endpoints

| Tool | Method + path | Scope (any of) |
|---|---|---|
| `list_projects` | `GET /api/0/organizations/{org}/projects/` | project:read |
| `get_project` | `GET /api/0/projects/{org}/{project}/` | project:read/write/admin |
| `list_team_projects` | `GET /api/0/teams/{org}/{team}/projects/` | project:read |
| `list_project_keys` | `GET /api/0/projects/{org}/{project}/keys/` | project:read/write/admin |
| `get_project_key` | `GET /api/0/projects/{org}/{project}/keys/{key_id}/` | project:read/write/admin |
| `list_project_environments` | `GET /api/0/projects/{org}/{project}/environments/` | project:read/write/admin |
| `list_project_teams` | `GET /api/0/projects/{org}/{project}/teams/` | project:read (+ see source) |
| `create_project` | `POST /api/0/teams/{org}/{team}/projects/` | project:write/admin |
| `update_project` | `PUT /api/0/projects/{org}/{project}/` | project:write/admin |
| `delete_project` | `DELETE /api/0/projects/{org}/{project}/` | project:admin |
| `create_project_key` | `POST /api/0/projects/{org}/{project}/keys/` | project:write/admin |
| `update_project_key` | `PUT /api/0/projects/{org}/{project}/keys/{key_id}/` | project:write/admin |
| `delete_project_key` | `DELETE /api/0/projects/{org}/{project}/keys/{key_id}/` | project:admin |
| `set_project_environment_visibility` | `PUT /api/0/projects/{org}/{project}/environments/{name}/` | project:write/admin |
| `add_team_to_project` | `POST /api/0/projects/{org}/{project}/teams/{team}/` | **project:admin** (see Risks) |
| `remove_team_from_project` | `DELETE /api/0/projects/{org}/{project}/teams/{team}/` | **project:admin** |

The cross-organization `GET /api/0/projects/` is not wrapped: `list_projects`
with an explicit `organization` covers it, and `list_organizations` gives the
organizations **[Decided by spec author]**.

## Tools

All: optional `organization` (D-11), optional `format`, `openWorldHint: true`.
Project names and slugs are operator-controlled, not event-derived — no
untrusted fence needed.

### Read

**`list_projects`** — readOnly, idempotent. "List projects in an organization
with slug, platform, teams and when the first event arrived." Input:
`query?: string` (GlitchTip project search, e.g. `!team:<slug>` for projects not
in a team — the only documented operator [Confirmed from the schema
description]), `limit?` 1–100 default 50, `cursor?`. Output per project: slug,
name, platform, team slugs, `firstEvent` (or "no events yet"), id.

**`get_project`** — readOnly. Input: `project: string` (slug). Output: slug,
name, id, platform, created, first event, event throttle rate, IP scrubbing,
public/bookmarked flags, organization slug.

**`list_team_projects`** — readOnly. Input: `team: string`, `limit?`,
`cursor?`.

**`list_project_keys`** — readOnly. "List a project's client keys (DSNs) — what
an application's Sentry SDK is configured with." Input: `project`, `limit?`,
`cursor?`. Output per key: id, label, created, rate limit, `dsn.public`,
`dsn.security`. The deprecated `dsn.secret` is not shown — it duplicates
`public` [Confirmed: `apps/projects/schema.py`]. A DSN is a client-side value
designed to ship in applications; showing it is not a breach of rule 1, which
covers the API token.

**`get_project_key`** — readOnly. Input: `project`, `key_id: string (uuid)`.

**`list_project_environments`** — readOnly. Input: `project`,
`visibility?: "visible"|"hidden"|"all"` default `visible`, `limit?`, `cursor?`.

**`list_project_teams`** — readOnly. Input: `project`, `limit?`, `cursor?`.

### Write (hidden in read-only mode)

**`create_project`** — not idempotent. "Create a project owned by a team."
Input: `team: string` (required — GlitchTip creates projects only under a team
[Confirmed]), `name`, `platform?` (free string, e.g. `python`, `javascript-react`),
`slug?`, `event_throttle_rate?: 0–100`. Output: the new project and, in the same
result, its default DSN fetched with `list_project_keys` — the thing a person
creating a project wants next **[Decided by spec author]**. If that follow-up
call fails, the result is still a **success** (the project exists — an error
would make the agent retry and create a duplicate), with the line "DSN fetch
failed: <message>; call list_project_keys(project)".

**`update_project`** — idempotent. Input: `project`, and at least one of
`name?`, `platform?`, `new_slug?`, `event_throttle_rate?`. PUT with `ProjectIn`
is full-replace [Confirmed: `name` required, other fields nullable], so the tool
**reads the project first and PUTs the complete current `ProjectIn`** (`name`,
`slug`, `platform`, `eventThrottleRate`) merged with the requested changes —
an unchanged field is always re-sent, never dropped. Output: the updated project.

**`delete_project`** — destructive. "Permanently delete a project with all its
issues, events and keys." Input: `project` (required), `confirm` = project slug.

**`create_project_key`** — not idempotent. Input: `project`, `label?`,
`rate_limit?: { window: seconds, count }`. Output: key id + DSN.

**`update_project_key`** — idempotent. Input: `project`, `key_id`, `label?`,
`rate_limit?: {window, count} | null` (null clears it). Same full-replace rule:
read the key first, PUT the complete `ProjectKeyIn` (`name`, `rateLimit`)
merged with the changes. The tool's `label` maps to the body field **`name`**
(`ProjectKeyIn` has no `label`; the response aliases `name` as `label`
[Confirmed: `apps/projects/schema.py`]). Same mapping for `create_project_key`.

**`delete_project_key`** — destructive. "Delete a client key; applications
using this DSN stop being able to send events." Input: `project`, `key_id`,
`confirm` = `key_id`.

**`set_project_environment_visibility`** — idempotent. Input: `project`,
`environment: string`, `hidden: boolean`. Body `{ name, isHidden }`.

**`add_team_to_project`** — idempotent. Input: `project`, `team`.

**`remove_team_from_project`** — not destructive (reversible), idempotent.
Input: `project`, `team`.

## Errors

- 404 → "Project <slug> was not found in <org>." / "Key <id> …" / "Team <slug> …".
- 403 on the team tools names `project:admin` and explains the upstream quirk
  (see Risks) in one sentence.
- `update_project` with no field to change → validation error, no request.

## Acceptance criteria

1. `src/toolsets/projects/index.ts` is `available: true`; `docs/tools/projects.md` documents every tool with its scope.
2. With `GLITCHTIP_TOOLSETS=projects` pinned in the test: `whoami` plus 7 read tools read-only; `whoami` plus 16 with writes enabled.
2a. `create_project` whose follow-up keys call fails returns success with the DSN-fetch-failed line.
3. Each tool: mocked-response test asserting method, path, body; one error-path test.
4. `update_project` with only `platform` changed sends the current `name`, `slug` and `eventThrottleRate` unchanged (GET then PUT, asserted in order and by body); `update_project_key` with only `label` changed re-sends the current `rateLimit` and sends `label` as `name`.
5. `create_project` returns the DSN of the new project (mocked follow-up call).
6. `list_project_keys` output contains `dsn.public` and never `dsn.secret` as a separate line.
7. Destructive tools reject a wrong `confirm` without any request.
8. No new dependency; no file outside the slot's `Owns` changed.

## Risks

- **Upstream quirk**: `add/remove team` are decorated with
  `has_permission(["project.write", "project:admin"])` — `project.write` with a
  dot, which matches no real scope [Confirmed: `apps/teams/api.py` at `v6.2.6`].
  In practice only `project:admin` works. The tool documents `project:admin`;
  an upstream report is a follow-up, not this PR's job.
- Project search operators beyond `!team:` are [Unknown]; the description
  promises only what is confirmed.

## Parallel plan

| Slot | Owns | Touches | Depends on | Lead | Model |
|---|---|---|---|---|---|
| p1-projects | toolset `projects` | `src/toolsets/projects/**`, `test/**/projects*`, `test/fixtures/projects/**`, `docs/tools/projects.md` | FEAT-20260925-001 merged | no | sonnet |

## Contention

| Resource | Owner | Everyone else |
|---|---|---|
| `src/toolsets/projects/**`, `docs/tools/projects.md` | p1-projects | do not open |
| `src/format/**`, `src/glitchtip/**`, `src/mcp/**`, `package.json` | nobody in phase 1 | message the orchestrator |
