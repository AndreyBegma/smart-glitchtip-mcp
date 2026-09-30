# Resources `issue` and `issue-event`

Two MCP **resource templates** (D-17, amended by D-26). A client reads an
issue, or an event of an issue, by URI through `resources/read`, and can
attach it to a conversation without the agent spending a tool call. A
resource body is exactly the text the matching tool returns with its
defaults: no new renderer, no new endpoint, no new setting.

| Template | Name | Toolset | Same text as |
|---|---|---|---|
| `glitchtip://issues/{issue_id}{?organization}` | `issue` | `issues` | `get_issue` |
| `glitchtip://issues/{issue_id}/events/{event_id}{?organization}` | `issue-event` | `events` | `get_latest_event` (`latest`) / `get_event` (an id) |

Both have `mimeType: "text/plain"`, and both descriptions end by saying the
content is untrusted data (D-18).

## When a template is listed

A template is registered with the toolset whose data it reads, and is
read-only, so `GLITCHTIP_READ_ONLY` never hides it (D-06, D-07).

| `GLITCHTIP_TOOLSETS` | `resources/templates/list` |
|---|---|
| default, or anything with `issues` and `events` | `issue`, `issue-event` |
| `issues` without `events` | `issue` |
| `events` without `issues` | `issue-event` |
| neither | no `resources` capability; `resources/*` are `-32601` |

`resources/list` is always `[]`: there are no static resources, and issues
are not enumerated (that is `list_issues`). There are no subscriptions:
stateless HTTP (D-04) cannot deliver `notifications/resources/updated`.

## URIs

- `glitchtip://issues/42` — issue 42 in the default organization.
- `glitchtip://issues/42?organization=acme` — issue 42 in `acme`.
- `glitchtip://issues/42/events/latest` — the issue's most recent event.
  Two reads may differ; the event header in the body carries the real id.
- `glitchtip://issues/42/events/<event id>` — one event of issue 42.

Events are read under their issue because GlitchTip has no route that reads
an event by id alone (D-26).

### Parameters

Checked before any request is made; a failure is `-32602`.

| Parameter | Rule | Message |
|---|---|---|
| `issue_id` | `^[1-9][0-9]{0,18}$`, a safe positive integer — the numeric id, not the shortId | `issue_id must be a positive integer (the numeric id, not the shortId).` |
| `event_id` | `latest`, 32 hex digits, or a canonical 8-4-4-4-12 UUID; case-insensitive | ``event_id must be an event id (32 hex digits or a UUID) or `latest`.`` |
| `organization` | absent, or a slug `^[A-Za-z0-9_-]+$` | `organization must be an organization slug.` |
| the URI | starts with lowercase `glitchtip://`, and its path does not end in `/` | `Unknown resource: <uri>` |

Values are checked after percent-decoding: `glitchtip://issues/%342` is issue
42, and `glitchtip://issues/5%2F..` is refused. A URI that is echoed in a
message has control characters and line breaks flattened to spaces and is cut
to 200 characters.

The organization is resolved as for tools (D-11): `?organization`, else the
`X-GlitchTip-Org` header (HTTP), else `GLITCHTIP_DEFAULT_ORG`, else the only
organization the token can see.

## Body

```ts
{ contents: [{ uri: <the requested URI, verbatim>, mimeType: 'text/plain', text }] }
```

- **Issue** — `get_issue`'s text. When the `events` toolset is enabled, one
  line follows it: `Latest event: glitchtip://issues/<id>/events/latest`, with
  `?organization=<slug>` only when the read URI carried it (never the header
  or default organization).
- **Event** — `get_latest_event`/`get_event`'s text with the tools' defaults:
  in-app frames, no local variables, no source context, no request headers,
  the last 10 breadcrumbs. The footer still names `get_event_json`, which the
  `events` toolset registers alongside.

There is no JSON variant: `format: "json"` stays a tool feature.

**Budget (D-12).** `text` is at most `MCP_RESPONSE_BUDGET` characters. The
issue body is built with its `Latest event:` line first and then bounded, so
the line cannot push it over; a cut never falls inside an open fence. The event
body is trimmed by the event renderer (breadcrumbs, then tags, then context)
before the stack is touched.

**Untrusted content (D-18) and redaction (D-20).** Inherited from the tools'
views: the issue title and culprit and every event section are fenced as
`<untrusted …>`. Request headers are omitted (`Cookie` and `Authorization`
never appear), and the user section is `id` and `email` only. The API token
is scrubbed from the body even when GlitchTip quotes it back inside content.

## Errors

A resource read has no `isError` result: every failure is a JSON-RPC error.

| Failure | Code | Message |
|---|---|---|
| no template matches (toolset disabled, typo) | `-32602` | `Unknown resource: <uri>` |
| a template matches but the URI is not canonical (`https://…`, `GLITCHTIP://…`, trailing `/`) | `-32602` | `Unknown resource: <uri>`; no request |
| malformed percent-encoding (`glitchtip://issues/%E0%A4%A`) | `-32603` | `URI malformed`; no request (raised by mcp-nest's matcher, known and accepted) |
| a parameter fails validation | `-32602` | the Parameters table; no request |
| GlitchTip 404 on the issue, or on `latest` | `-32602`, `data: { uri }` | `Issue <id> was not found in <org> (it may be in another organization, or deleted).` |
| GlitchTip 404 on an event by id | `-32602`, `data: { uri }` | `Event <event_id> was not found for issue <id>.` |
| no default organization | `-32602` | the tools' message, then `For a resource, add ?organization=<slug> to the URI.` |
| 401, 403 (naming the scopes), 429, 5xx, timeout, unreachable, `X-GlitchTip-Url` refused | `-32603` | the tools' message, unchanged |
| GlitchTip's response has a shape the view cannot read | `-32603` | the tools' malformed message, naming e.g. `get_issue (resource glitchtip://issues/42)` and an error id |
| anything else | `-32603` | `Internal error in smart-glitchtip-mcp (<error id>).` |

No message contains the token. Stacks go to stderr under the error id, with
secrets stripped.

## Scopes and endpoints

| Resource | Endpoint | Scope (any of) |
|---|---|---|
| issue | `GET /api/0/organizations/{org}/issues/{issue_id}/` | `event:read`, `event:write`, `event:admin` |
| event, `latest` | `GET /api/0/organizations/{org}/issues/{issue_id}/events/latest/` | same |
| event, by id | `GET /api/0/organizations/{org}/issues/{issue_id}/events/{event_id}/` | same |

## HTTP transport

`resources/read` goes through the same guard and instance resolution as
`tools/call` (D-03, D-05, D-11): no credentials is `401`; a pass-through
`Authorization: Bearer` is the token GlitchTip sees; `X-GlitchTip-Org` is the
default organization; `X-GlitchTip-Url` must be on `GLITCHTIP_ALLOWED_URLS`.
