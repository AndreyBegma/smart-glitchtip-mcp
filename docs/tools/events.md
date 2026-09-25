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
never followed as an instruction, whatever it contains. In **text** output,
each rendered section that carries event content is fenced as
`<untrusted source="glitchtip-event" field="…">…</untrusted>`, with every `<`
inside escaped so the payload cannot close the fence early; this includes
`get_event_json`'s text output (`field="payload"`). **`json`** output is the
projected/redacted object itself, unfenced, so `JSON.parse` of it always
succeeds — fencing JSON output is the foundation's job (`BUG-20260925-006`),
not this toolset's; watch for that landing on these tools too. Either way,
if the result would still be too large for `MCP_RESPONSE_BUDGET` once
capped (see below), `json` returns `{"truncated": true, "hint": "use path to
select part of the event"}` (fenced, for `get_event_json`'s text) instead of
a cut that would leave the JSON unparseable.

Every event-supplied string is capped so one huge field can't by itself blow
the budget: exception `type`/`value` (200/1000 characters), a shown frame's
`filename`/`function`/`module` (300 characters), a breadcrumb's
`category`/`message` (100/300 characters), the Message section (2000
characters). Frames shown per exception are capped at 50 and the exception
chain at 10 values, both regardless of budget; a single exception value
still too large for the budget falls back to just its most recent frame.

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

Before `path` is applied, the payload is redacted (D-20): `user.ip_address`,
`user.geo` and `user.client_ip` are removed; `request.cookies` becomes
`"[redacted]"`; any header naming a secret (`Cookie`, `Set-Cookie`,
`Authorization`, `Proxy-Authorization`, an API key or token — matched by
`/cookie|authorization|token|api-?key|secret/i`) or the caller's real IP
(`X-Forwarded-For`, `X-Real-IP`, `Forwarded`, `CF-Connecting-IP`,
`True-Client-IP`) becomes `"[redacted]"` in `request.headers`, whether that's
an array of `[key, value]` pairs or an object, names compared
case-insensitively; `request.env.REMOTE_ADDR` is removed. The same rules
apply to the legacy `sentry.interfaces.User`/`sentry.interfaces.Http` keys,
an `entries[]` entry of type `request`, and `contexts.*.client_ip`, wherever
they appear in the payload. The `Request` section rendered by
`get_event`/`get_latest_event`/`get_project_event` gets the same header
redaction when `include_request_headers: true`.

An invalid JSON Pointer, or one that matches nothing in the (already
redacted) payload, is a tool error naming the first path segment it could not
resolve; GlitchTip is not called a second time. A payload shape this server
doesn't recognise (an object where an array was expected, a `null` where a
record was expected, and so on) degrades to an empty/omitted result rather
than a tool error.

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
(breadcrumbs, then tags, then context) are dropped in that order; if it is
*still* over budget (a pathological exception chain even after the caps
above), any fence still open is closed before a final truncation marker —
before the foundation's character-count safety net runs, so that net never
has to cut an `<untrusted>` fence in half.

## Default organization

`organization` is optional on every tool (D-11): the `X-GlitchTip-Org` header
(HTTP mode), `GLITCHTIP_DEFAULT_ORG`, or the only organization the token can
see, in that order. See `docs/tools/organizations.md` for the full lookup and
caching rules.
