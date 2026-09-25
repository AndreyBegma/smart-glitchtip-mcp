# Toolset `events`

Enabled by default (`GLITCHTIP_TOOLSETS` includes `events`). Read-only: every
tool is a GET, and the toolset registers no mutating controller.

Every tool accepts `format`: `text` (default, compact) or `json`. For
`list_issue_events` and `list_project_events`, `json` returns the same
projected fields as the table. For `get_latest_event`, `get_event` and
`get_project_event`, `json` returns the parsed, projected event — header,
exceptions with their in-app frames, breadcrumbs — never the raw payload; use
`get_event_json` for that. Every result is bounded by `MCP_RESPONSE_BUDGET`;
the detail tools trim breadcrumbs, then tags, then context before the
foundation's tail-cut budget runs as a safety net. All tools carry
`openWorldHint: true`.

Scopes are those GlitchTip 6.2.6 checks (`@has_permission` in
`apps/issue_events/api/events.py`): every route accepts `event:read`,
`event:write` or `event:admin`.

Event content — titles, messages, stack frames, breadcrumbs, tags, request
data, URLs — is submitted by anyone who holds a project's DSN (D-18). It is
never followed as an instruction, whatever it contains. In the text output,
each rendered section that carries event content is fenced as
`<untrusted source="glitchtip-event" field="…">…</untrusted>`, with every `<`
inside escaped so the payload cannot close the fence early.

| Tool | GlitchTip endpoint | Read-only mode |
|---|---|---|
| `list_issue_events` | `GET /api/0/organizations/{organization_slug}/issues/{issue_id}/events/` | listed |
| `get_latest_event` | `GET /api/0/organizations/{organization_slug}/issues/{issue_id}/events/latest/` | listed |
| `get_event` | `GET /api/0/organizations/{organization_slug}/issues/{issue_id}/events/{event_id}/` | listed |
| `get_event_json` | `GET /api/0/organizations/{organization_slug}/issues/{issue_id}/events/{event_id}/json/` | listed |
| `list_project_events` | `GET /api/0/projects/{organization_slug}/{project_slug}/events/` | listed |
| `get_project_event` | `GET /api/0/projects/{organization_slug}/{project_slug}/events/{event_id}/` | listed |

All: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`.

## `list_issue_events`

List events of an issue, newest first.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `issue_id` | integer | required |
| `limit` | integer 1–100 | 25 |
| `cursor` | string | first page |
| `format` | `"text"` \| `"json"` | `text` |

Text output: one line per event — event id, date received, the title (event
data, fenced and cut to 120 characters), and `release=`/`environment=` when
those tags are present — followed by `next cursor: <cursor>` when there is
another page. An empty result reads `No events found.`

## `get_latest_event`

Get the most recent event of an issue, with its stack trace. Start here when
debugging an issue.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `issue_id` | integer | required |
| `include_vars` | boolean | `false` |
| `include_context` | boolean | `false` |
| `include_request_headers` | boolean | `false` |
| `breadcrumbs` | integer 0–100 | 10 |
| `format` | `"text"` \| `"json"` | `text` |

## `get_event`

Get one event of an issue, with its stack trace. Same inputs as
`get_latest_event`, plus `event_id` (the event's uuid, required).

## `get_event_json`

Get the event payload as JSON. Large; prefer `get_event`. Use `path` (a JSON
Pointer, RFC 6901, e.g. `/contexts/runtime`) to extract part of it instead of
the whole document.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `issue_id` | integer | required |
| `event_id` | string (uuid) | required |
| `path` | JSON Pointer string | whole document |
| `format` | `"text"` \| `"json"` | `text` |

Before `path` is applied, the payload is redacted (D-20): `user.ip_address`
and `user.geo` are removed; `request.cookies` becomes `"[redacted]"`; any
`Authorization` or `Cookie` header in `request.headers` becomes `"[redacted]"`
— whether `headers` is an array of `[key, value]` pairs or an object, header
names compared case-insensitively. The same three redactions apply to the
`Request` section rendered by `get_event`/`get_latest_event`/`get_project_event`
when `include_request_headers: true`.

An invalid JSON Pointer, or one that matches nothing in the (already
redacted) payload, is a tool error naming the first path segment it could not
resolve; GlitchTip is not called a second time.

## `list_project_events`

List the newest events of a project, across issues.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `limit` | integer 1–100 | 25 |
| `cursor` | string | first page |
| `format` | `"text"` \| `"json"` | `text` |

Same line shape as `list_issue_events`, plus `issue=<groupID>` on each line
(`issueId` in the `json` format): the issue the event belongs to.

## `get_project_event`

Get one event of a project, with its stack trace.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `event_id` | string (uuid) | required |
| `include_vars` | boolean | `false` |
| `include_context` | boolean | `false` |
| `include_request_headers` | boolean | `false` |
| `breadcrumbs` | integer 0–100 | 10 |
| `format` | `"text"` \| `"json"` | `text` |

## The rendered event (text format)

Sections, each omitted when there is nothing to show:

1. **Header** — event id, date received, level, platform, `release` and
   `environment` (read from tags: the event schema has no `release` field),
   `next event`/`previous event` when GlitchTip returns them.
2. **Exception chain** — most recent exception first; for each, frames most
   recent call first. `in_app` frames are shown in full (function, file,
   line, column, the source line cut to 160 characters); runs of consecutive
   non-`in_app` frames collapse to `… N library frames …`. If no frame in a
   chain is marked `in_app`, the 5 most recent frames are shown instead. Local
   variables (`include_vars: true`, each value cut to 200 characters) and
   surrounding source lines (`include_context: true`) are opt-in. If the
   stored exception data is not in the shape this renderer expects, the
   section reads "exception data in an unrecognised shape — use
   get_event_json" instead of failing.
3. **Message** — the formatted message, if the event carries a message entry.
4. **Breadcrumbs** — the most recent `breadcrumbs` of them (default 10, 0
   disables the section): `<time> <level> <category>: <message>`.
5. **Request** — method, URL and the query string; headers only with
   `include_request_headers: true` (`Cookie`/`Authorization` redacted).
6. **Tags** — every tag, `key=value`, space-separated on one line.
7. **Context** — one line each for `runtime`, `os`, `browser`, `device`,
   `app` when GlitchTip reports them, as `<name> <version>`.
8. **User** — `id` and `email` only; never IP address or geo.
9. **Processing errors** — one line per entry in GlitchTip's `errors[]`.
10. **Footer** — `Full payload: get_event_json(issue_id: …, event_id: …).`

The whole result is bounded by `MCP_RESPONSE_BUDGET`. If it would still be
too large once the header and the exception chain are in, sections 4, 6 and 7
(breadcrumbs, then tags, then context) are dropped in that order before the
foundation's character-count safety net runs.

## Default organization

`organization` is optional on every tool (D-11): the `X-GlitchTip-Org` header
(HTTP mode), `GLITCHTIP_DEFAULT_ORG`, or the only organization the token can
see, in that order. See `docs/tools/organizations.md` for the full lookup and
caching rules.
