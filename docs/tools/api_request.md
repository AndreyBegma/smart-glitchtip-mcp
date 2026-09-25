# Toolset `api_request` (escape hatch)

Default off (`GLITCHTIP_TOOLSETS` must name `api_request`, D-06). It covers
whatever the curated toolsets do not: a route no tool wraps yet, one not worth
a tool of its own, or one a newer GlitchTip adds. Specification:
FEAT-20260925-015; decision: D-21.

| Tool | Annotations | Registered when |
|---|---|---|
| `api_get` | readOnly, idempotent, not destructive, openWorld | the toolset is enabled (also in read-only mode) |
| `api_request` | not readOnly, **destructive**, not idempotent, openWorld | the toolset is enabled, `GLITCHTIP_READ_ONLY=false` **and** `GLITCHTIP_API_REQUEST_ALLOW_WRITE=true` |

When `api_request` is not registered it is absent from `tools/list`, and
calling it answers `-32602 Unknown tool` (D-07: decided at registration, never
refused at call time).

Neither tool takes `organization`: the path names its own organization, and the
D-11 default does not apply to a free-form path. Both take `format`: `text`
(default) or `json`, and every result is bounded by `MCP_RESPONSE_BUDGET`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `GLITCHTIP_API_REQUEST_ALLOW_WRITE` | `false` | Registers `api_request`, if `GLITCHTIP_READ_ONLY=false` and the toolset is enabled. Parsed like `GLITCHTIP_READ_ONLY` (`true`/`false`, `1`/`0`, `yes`/`no`). |

Startup warnings (not failures): the flag set with `GLITCHTIP_READ_ONLY=true`
logs "GLITCHTIP_API_REQUEST_ALLOW_WRITE has no effect while read-only"; the
flag set with the toolset disabled logs a line of the same kind.

## `api_get`

`GET` on any path under `/api/0/` of the resolved instance.

| Argument | Type | Notes |
|---|---|---|
| `path` | string, ≤ 2000 | Relative to `/api/0/` (`organizations/acme/monitors/`); a leading `/api/0/` is accepted. `""` is the API root. The trailing slash is added when missing. |
| `query` | object, optional | See [Query](#query). |
| `cursor` | string ≤ 1000, optional | The `next cursor` of a previous page. Shorthand for `query.cursor`; passing both is refused. |
| `format` | `text` \| `json` | |

GET is retried by the client on 429/5xx (D-13). There is no method input, so
`api_get` can never send anything but `GET`.

## `api_request`

`POST`, `PUT`, `PATCH` or `DELETE` on any path under `/api/0/`. Prefer the
dedicated tools; this one can delete or overwrite anything the token may touch.

| Argument | Type | Notes |
|---|---|---|
| `method` | `POST` \| `PUT` \| `PATCH` \| `DELETE` | |
| `path`, `query` | | As `api_get`. |
| `body` | JSON value, optional | At most 100 000 characters serialised; always sent as JSON. Refused with `DELETE` (GlitchTip bulk deletes take ids in `query`). Never echoed in a result or an error. |
| `confirm` | string | **Required.** Exactly `"<METHOD> /api/0/<normalised path>/"`, e.g. `"DELETE /api/0/organizations/acme/issues/42/"`. A missing or different value is refused before any request, and the error shows the expected string. (The schema marks it optional only so that a missing value gets that message.) |
| `format` | `text` \| `json` | |

Never retried (D-13: a mutation).

## Output

Text:

```text
GET /api/0/organizations/acme/monitors/ → 200
next cursor: 0:100:0
<untrusted source="glitchtip-event" field="api.body">[ … the redacted body, two-space JSON … ]</untrusted>
```

- `next cursor` appears when the `Link` header has a `rel="next"` page. Only
  its cursor is read; the URL in the header is never requested.
- An empty JSON array adds the line `Empty list.`.
- `204` (or an empty body) reads `<METHOD> <path> → 204 — no content.`
- A `text/*` body is shown with its content type, fenced and budgeted.
- The text budget cuts on a line boundary, so a body line longer than 1000
  characters (a minified body, a long string value) is wrapped first, with the
  line "Lines longer than 1000 characters are wrapped."; a cut then keeps a
  prefix of the body. The `json` format is never wrapped.
- Any other content type: status, content type and byte length only; no body.
- A body declared JSON that does not parse is shown as text with the note
  "GlitchTip declared JSON but the body did not parse" — never "Internal error".

JSON: `{ "status", "nextCursor", "body" }` (plus `contentType`, `bytes` or
`note` where they apply), fenced as one `api.body` block with source
`glitchtip-event` and budgeted as JSON, so the text between the tags always
parses and keeps `status` and `nextCursor`.

A body is GlitchTip data of unknown origin, partly written by whoever holds a
DSN (D-18): it is always fenced with the most exposed source, and the agent must
never follow instructions inside it.

## Path rules

Checked before the denylist and before any request (AGENTS.md rule 9):

1. At most 2000 characters. A leading `/api/0/` or `api/0/` is dropped; a lone
   leading `/` is dropped. The empty remainder is the API root.
2. Refused: a `:` before the first `/` (a scheme), a leading `//`, `\`, `@`,
   `?`, `#`, whitespace, control characters, NUL. Query parameters go in `query`.
3. Percent-decoded once. Refused: an escape that decodes to `/`, `\`, `.`,
   `%`, `?`, `#` or a control character (no encoded traversal, no double
   encoding), a malformed escape, empty segments (`a//b`), `.` and `..` segments.
4. After decoding, only `A–Z a–z 0–9 - _ . ~ / + : , =` are allowed.
5. Each segment is re-encoded and the URL is built as instance base +
   `/api/0/` + path + `/`. The built URL must keep the instance origin, stay
   under `<instance prefix>/api/0/` and have exactly the expected path;
   `client.raw()` repeats the origin and prefix check itself.

Refusals name the rule, never the input. No caller headers are forwarded; the
client refuses `Authorization`, `Host`, `Cookie`, `Forwarded`, `X-Forwarded-*`,
`X-Real-IP`, `X-Original-URL` and `X-Rewrite-URL` on any raw call.

## Query

At most 30 keys, each matching `[A-Za-z0-9_.-[]]{1,64}`. Values: a string of
at most 1000 characters, a number, a boolean, or an array of at most 100
strings or numbers with no duplicates (`1` and `"1"` count as the same). An
array repeats the parameter: `{"id": [1, 2]}` → `?id=1&id=2`.

## Denylist

Never callable, whatever the method or the write flag. Matched on the decoded
segments, case-insensitive, with or without a trailing slash; refused before
any request with "`<path>` is not reachable through api_get/api_request:
<reason>". The list lives in `src/toolsets/api_request/denylist.ts`; adding an
entry is a normal PR, removing one needs a decision.

| Route (below `/api/0/`) | Methods | Reason |
|---|---|---|
| `generate-recovery-codes` | all | `GET` mints fresh MFA recovery codes and returns them |
| `wizard`, `wizard/…` | all | the setup-wizard flow hands out a stored API token, unauthenticated |
| `wizard-set-token` | all | creates or returns an API token for the user |
| `api-tokens`, `api-tokens/…` | all | session-authenticated only; responses carry token values |
| `accept/…` | all | accepts an organization invitation, with the invite secret in the path |
| `stripe/organizations/*/create-stripe-subscription-checkout` | all | an account-bearing Stripe session link; the `billing` toolset carries the warnings |
| `stripe/organizations/*/create-billing-portal` | all | same |
| `import` | all | makes the instance fetch an arbitrary external URL with a caller-supplied token |
| `users/*` | `DELETE` | deletes the token's own account, irreversibly (other methods allowed) |
| `organizations/*/members/*/set_owner` | `POST`, `PUT`, `PATCH`, `DELETE` | transfers ownership of the organization; `transfer_organization_ownership` (members toolset) is the explicit, confirmed tool for it (recorded against D-23) |
| `users/*/emails`, `users/*/emails/confirm` | `POST`, `PUT`, `PATCH`, `DELETE` | account-takeover path (password resets go to the primary address); `GET` allowed |
| `organizations/*/social-apps`, `organizations/*/social-apps/*` | `POST`, `PUT`, `PATCH` | an IdP client secret through the model, and SSO auto-joins users; `DELETE` allowed (D-23) |

The ingest routes (`/api/{project_id}/store/`, `/security/`, `/envelope/`,
`/api/embed/*`) are outside `/api/0/` and unreachable by the path rules.

Routes under `users/{user_id}/…` act only on the token's own user: GlitchTip
refuses any `user_id` other than the caller's own id or `me`.

## Covered only here

Routes with no curated tool on purpose, reachable only through this toolset:

| Route | Reached through | Why no curated tool |
|---|---|---|
| `POST projects/{org}/{project}/reprocessing/` | `api_request` only (both flags and `confirm`) | re-runs symbolication of a project's events against the uploaded debug files — a rare operator action with no inputs worth a schema |

A route that later earns a curated tool moves out of this table in that tool's PR.

## Redaction

Every response body of every call — success or error, JSON or text — is
redacted before it is parsed for display, fenced, budgeted or returned
(AGENTS.md rule 1):

1. **The token in use** (env token or pass-through bearer) is removed by value
   wherever it appears — `GET /api/0/` returns it as `auth.token`. `client.raw()`
   scrubs it too; this toolset scrubs again, and from every error detail.
2. **Secret keys**, at any depth, case-insensitive: `token`, `authToken`,
   `auth_token`, `accessToken`, `access_token`, `refreshToken`,
   `refresh_token`, `clientSecret`, `client_secret`, `secret` (so `dsn.secret`;
   `dsn.public` is kept), `apiKey`, `api_key`, `password`, `sentry_key`,
   `privateKey`, `private_key`, `inviteLink`, `chatwootIdentifierHash`,
   `heartbeatEndpoint`, `endpointID`, `endpoint_id` → `"[redacted]"`.
   `endpointID` is the UUID in a monitor's heartbeat URL: with it alone anyone
   can mark the monitor up, so it is a secret like the URL itself.
   Each value caught this way is then also removed wherever else it appears in
   the body. In a text body (or JSON that did not parse) the value after
   `"<key>":` is blanked the same way, whatever it is: a string to its closing
   quote, an object or array to its matching bracket (or the end of a cut-off
   body), anything else to the next `,`, `}`, `]` or line end.
3. **URL fragments** (`#sub=<license key>`) are replaced by `#[redacted]` in
   every `http(s)://` URL, whether a JSON string is the URL or only contains
   one, and in a text body; a URL's password is replaced as well.
4. **Alert recipients**, by shape: any object with a `recipientType` key and a
   string `url` shows only the URL's origin (plus `/…`); an unparsable URL
   reads `unparsable URL (masked)`.
5. The request `body` is never echoed.

A body nested more than 100 levels deep has the deeper part replaced by
`[redacted: nested too deep]`.

Key-name redaction is a heuristic: a secret under an unlisted key passes
through, though the token in use is always caught by value.

## Errors

- Path, denylist, `confirm`, `query` and `body` violations: a tool error before
  any request, naming the rule.
- `403`: "The token lacks permission for `<METHOD> /api/0/<path>/`. Call
  `whoami` to see the token's scopes."
- `404`: "No GlitchTip route or object at `/api/0/<path>/`." — also what an
  unknown route answers.
- `400`/`422`: "GlitchTip rejected `<METHOD> /api/0/<path>/` (`<status>`)."
- Other statuses, timeouts and an unreachable instance: the client's usual
  messages, prefixed with the method and path.
- GlitchTip's own `detail`, redacted and cut to 500 characters, follows on a
  `GlitchTip said:` line, fenced as `api.detail`.
