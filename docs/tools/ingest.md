# Toolset `ingest`

Default off (`GLITCHTIP_TOOLSETS` must list `ingest`). Both tools are writes and are registered
only when `GLITCHTIP_READ_ONLY=false`; the toolset has no read tools at all, so in read-only mode
it contributes nothing beyond `whoami`.

Both tools put a real event into the project: it becomes an issue tagged
`smart-glitchtip-mcp: test`, counts toward quota, and marks a project that has never received an
event as having its first one. Neither is destructive, neither is idempotent. Both carry
`openWorldHint: true` and accept `format`.

| Tool | GlitchTip endpoint | readOnly | destructive | idempotent | Read-only mode |
|---|---|---|---|---|---|
| `send_test_event` | `GET .../keys/` then `POST /api/{projectID}/store/` | no | no | no | hidden |
| `send_test_security_report` | `GET .../keys/` then `POST /api/{projectID}/security/` | no | no | no | hidden |

## Choosing the key

Neither tool ever takes a host from the caller, and never sends anything anywhere except the
resolved instance (D-03, AGENTS.md rule 9). Before it sends anything:

1. It lists the project's client keys through the API (`GET
   /api/0/projects/{organization_slug}/{project_slug}/keys/`) on the resolved instance.
2. It picks one:
   - `key_id` (a key's id, uuid): that key, or `Key <id> is not a client key of <org>/<project>.`
   - `dsn` (`scheme://public[:secret]@host[/prefix]/projectID`, parsed locally — never sent
     anywhere, and its secret is never echoed): the key whose public id and project id both
     match, or `This DSN is not a key of <org>/<project> on <instance origin>.` with no request
     made to the DSN's own host. When the DSN's host differs from the resolved instance's host,
     the result also carries a line naming both — a diagnostic, not a redirect.
   - neither: the project's sole key, or a validation error listing every key's `id | label` and
     asking for `key_id` — a key's `label` is set by whoever administers the project, so it is
     fenced as untrusted (`glitchtip-config`) inside that message.
   - `key_id` and `dsn` together: a validation error, before any request.
   - a key that answers `isActive: false`: `Key <id> is inactive.`, no send. A key response that
     omits the field counts as active.
3. It sends to `<resolved instance origin>/api/<projectID>/store-or-security/?sentry_key=<public>`
   — `projectID` and `public` come from the keys response, never the caller's `dsn`. Both are
   checked before use (a positive integer, a uuid); a keys response that does not shape them this
   way is `isError` ("did not expect"), never trusted into the request path or query string.

The API token still travels as `Authorization` on every call, including the ingest POST (it is
the same origin that header already authenticates against, and the DSN key takes precedence for
that route); it never appears in a result.

## `send_test_event`

Check that a project's DSN accepts events.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `key_id` | uuid | — |
| `dsn` | string, ≤ 500 characters | — |
| `message` | string, 1–500 characters | `smart-glitchtip-mcp test event` |
| `level` | `"debug"` \| `"info"` \| `"warning"` \| `"error"` \| `"fatal"` | `info` |
| `environment` | string, 1–64 characters | — |
| `release` | string, 1–200 characters | — |
| `wait_seconds` | integer 0–30 | 0 |
| `format` | `"text"` \| `"json"` | `text` |

Sends `{ event_id, timestamp, platform: "other", level, logger: "smart-glitchtip-mcp", message,
tags: { "smart-glitchtip-mcp": "test" }, environment?, release? }` to the store route. Outcome:

| GlitchTip answer | Result |
|---|---|
| 200 `{event_id}` | success: "Accepted: event `<id>` via key `<key id>` (project `<projectID>`)." |
| 401 | `isError`: the DSN key was rejected (unknown or inactive; GlitchTip remembers a rejection for 30 s) |
| 403 | `isError`: "The DSN key does not have permission to send to project `<projectID>` (403)." — never mentions the server's own token |
| 422 | `isError`: "GlitchTip refused the event as malformed: `<detail>`." |
| 429 | `isError`: throttled, not retried |
| 503 | `isError`: "Ingest is paused on this instance (maintenance)." |
| other | the foundation's mapping |

A 200 whose body's `event_id` is not the 32-hex form this server sent (or literally the id sent)
is still a success — the reply is read, and its `event_id` is not, when it is not one this server
recognises as the event it just sent — with a note that the reply was not in the expected shape.

With `wait_seconds > 0`, polls `GET
/api/0/projects/{organization_slug}/{project_slug}/events/{event_id}/` every 2 s (event id in
canonical dashed form) until it answers 200 or the deadline passes, and appends either "Processed:
the event is visible (issue `<groupID>`)." or "Accepted but not visible after `<n>` s. The worker
may be behind; this is not a DSN failure." Each poll attempt's own timeout is bounded to what is
left of `wait_seconds` (floored at 100 ms), so a slow poll cannot itself run longer than the budget
the caller asked for; a per-attempt timeout or transport failure stops polling the same way running
out of `wait_seconds` does. A 401 or 403 on the poll means the server's own token was rejected or
cannot read events — not that the DSN key failed — and leaves the send's own success intact.

## `send_test_security_report`

Check that a project accepts browser CSP reports.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `project` | slug | required |
| `key_id` | uuid | — |
| `dsn` | string, ≤ 500 characters | — |
| `format` | `"text"` \| `"json"` | `text` |

Sends a fixed CSP violation report (`document-uri`/`blocked-uri` on the `.invalid` TLD, which
cannot resolve) to the security route. 201 with no body is a success, "Accepted via key `<key
id>`."; every other status maps as `send_test_event`'s table above.
