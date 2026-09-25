---
title: "Foundation: valid JSON under the budget, fence-aware truncation, malformed responses as agent errors, the client surface phase 2 needs"
tracking_id: BUG-20260925-006-foundation-json-budget
skill: glitchtip-spec
status: ready
phase: 1
wave: 0
depends_on: [FEAT-20260925-001-foundation, FEAT-20260925-002-issues-toolset, FEAT-20260925-003-events-toolset]
created_at: 2026-09-25
---

# BUG-20260925-006 — Foundation output fixes

## Summary

Three defects in the foundation's shared output path, found by the adversarial
reviews of the issues (PR #9) and events (PR #8) toolsets. They affect every
toolset, so they are fixed once, here, and no toolset works around them.

1. **`format: "json"` is cut as text.** `ToolOutput.render`
   (`src/format/tool-output.ts`) applies `applyBudget` to the serialised JSON
   string, so any JSON result over `MCP_RESPONSE_BUDGET` reaches the agent as
   broken JSON ending in the truncation marker [Confirmed: review probe — 100
   issues with `format: "json"`]. D-12 promises a bounded result the agent can
   use; invalid JSON is neither.
2. **A text cut can land inside an `<untrusted>` fence** (D-18). `applyBudget`
   cuts on a line boundary, which may be inside a multi-line fenced block; the
   marker then sits inside an unclosed fence and later text reads as data
   [Confirmed: review probe on comment text and event sections].
3. **An unexpected response shape becomes "Internal error".** A view that hits
   `null` where the schema promised a value throws `TypeError`, which the
   `ToolErrorFilter` maps to "Internal error in smart-glitchtip-mcp (<id>)"; a
   list endpoint answering with an object instead of an array does the same
   [Confirmed: review probes]. Rule 7 asks for an error an agent can act on.
   Toolsets now guard their own views (`?? ''`), but the foundation must be the
   backstop.

This row is also **wave 0 of phase 2**: every phase 2 toolset spec
(FEAT-20260925-007 … -015) depends on it, and it lands the shared surface they
need so that no toolset slot has to edit `src/format/**`, `src/glitchtip/**`,
`src/mcp/**` or `test/support/**`: a raw call and response headers on the
client, a per-call timeout, fence source labels, fenced JSON views,
conditional write registration, a path-segment guard, and tests that no longer
break when a toolset becomes available.

## Changes

### 1. JSON budgeting — `src/format/budget.ts`, `src/format/tool-output.ts`

`applyJsonBudget(value: unknown, budget: number): unknown` returns a value whose
`JSON.stringify(v, null, 2)` fits the budget, and is **always valid JSON**:

- If it fits, return it unchanged.
- If the value is an array: keep the longest prefix that fits inside the wrapper
  `{ "truncated": true, "returned": k, "total": n, "hint": "…", "items": [...] }`.
  If not even one item fits, the first item is budgeted as an object (next
  rule) and kept as the only item, `returned: 1`.
- If the value is an object: **top-level scalars are always kept** (for example
  `status`, `nextCursor`, `id`, `count`). While the value does not fit, find the
  largest shrinkable node by descending, at every level, into the property (or
  array element) with the largest serialised size — **at any depth** — and
  shrink it: an array is halved (keeping its prefix), a string longer than 2000
  characters is cut to a string ending `…[truncated]`, and an object is
  descended into. Repeat until it fits or nothing is shrinkable. `"truncated":
  true` and `"hint"` are set at the top level (overwriting keys of the same
  name).
- If nothing fits, return `{ "truncated": true, "hint": "…" }` plus the
  top-level scalars when those still fit, else the two keys alone.
- `hint` = "Result exceeded the response budget. Narrow the query, use cursor, or (for events) use get_event_json with path."

`ToolOutput.render` uses `applyJsonBudget` for `json` and `applyBudget` for
`text`. A toolset never cuts JSON itself.

### 2. Fence-aware text cut — `src/format/budget.ts`

After choosing the cut point, `applyBudget` counts `<untrusted` openings and
`</untrusted>` closings in the kept text (the escaping in `untrusted.ts` ensures
payload text cannot contain either). If a fence is open, it appends
`</untrusted>` before the marker. The marker is never inside a fence.

### 3. Malformed responses — `src/mcp/tool-error.filter.ts`, `src/format/tool-output.ts`, `src/glitchtip/`

Two layers, so a malformed response never reaches the agent as "Internal
error":

- **Filter (primary).** `ToolErrorFilter` maps a `TypeError` or `RangeError`
  thrown anywhere in a tool call — in the handler, while a view is
  **constructed** (for example the `organizationDetailView(body)` factory
  reading `body.projects.length` before it returns the view), or while it
  renders — to a `malformed` agent error:
  "GlitchTip returned a response this server did not expect for <tool name>
  (<error id>). The request itself succeeded; try format \"json\", or `api_get`
  (the `api_request` toolset, off by default) to see the raw payload." The tool
  name comes from the RPC data mcp-nest hands the filter (the `tools/call`
  params) [Unknown: the exact shape of `host.switchToRpc().getData()` —
  verify; if it carries no name the message says "this call"]. The stack is
  logged with the error id exactly as for an internal error (next bullet); the
  agent sees no stack. Network failures do not reach this branch: the client
  already turns them into `unreachable`/`timeout`.
- **`render` (second layer).** `ToolOutput.render` calls `view.text()` /
  `view.json()` inside `try/catch` and throws the same `malformed` error for a
  `TypeError`/`RangeError`. **[Decided by spec author]**: `render` gains an
  optional `operation` argument (the tool name), defaulted to "this call", so no
  existing call site breaks.
- **Log redaction.** Every internal-error and malformed log line goes through
  `redactSecrets` with every secret the request could know (env token,
  `MCP_AUTH_TOKEN`, pass-through bearer) — the filter's existing list, applied
  to the new branch too. A stack cannot be scrubbed of secrets the foundation
  does not know, so **toolset formatters and views never put a response value
  into a thrown message** (`throw new Error(\`bad url ${url}\`)` is a defect;
  name the field, not its value), and they test URLs with `URL.canParse` rather
  than letting `new URL(value)` throw. Every phase 2 spec inherits this rule.
- The client's list helper (`page()`) checks `Array.isArray(body)`; otherwise
  it throws the same `malformed` error.
- `glitchtip.errors.ts` gains `malformed` in the kind table, and the existing
  `malformedResponseError()` ("…not valid JSON; is the instance URL pointing at
  GlitchTip?") moves from kind `upstream` to kind `malformed`, message
  unchanged.
- **Path-segment guard (defence in depth).** The client registers an
  openapi-fetch `onRequest` middleware that compares the number of segments of
  the built request's pathname (below the instance prefix) with the number in
  the call's `schemaPath` template; a mismatch (a parameter value such as `..`
  that URL normalisation collapsed) throws an `invalid` `GlitchTipError`
  ("A path parameter is not a single path segment.") **before** the request is
  sent [Unknown: that openapi-fetch 0.17.0 passes `schemaPath` to middleware —
  verify; if not, compare against the template the typed call names].
- **Shared input guard.** `src/mcp/tool-params.ts` gains
  `pathSegmentParam(label, maxLength)`: a zod string, `.min(1)`, refusing a
  value that is `.`, `..` or only dots, or that contains `/`, `\`, `%` or a
  control character, with a message naming the rule. Any free-form input a tool
  puts into a URL path (release versions, names) uses it; slug inputs keep the
  slug regex, which already excludes all of these. **[Decided by spec author —
  the rule is shared so every toolset refuses the same way.]**

### 4. Fence source label — `src/format/untrusted.ts`

`untrusted(field, text)` always writes `source="glitchtip-event"`, which is
wrong for member names, webhook URLs, release refs or Stripe text (found while
specifying phase 2). Add an optional third argument
`source: 'glitchtip-event' | 'glitchtip-user' | 'glitchtip-config' | 'external'`
defaulting to `'glitchtip-event'`, so no existing call site changes.

### 5. Fenced JSON output and the source convention — `src/format/tool-output.ts`

`View` gains an optional `untrusted?: { field: string; source?: UntrustedSource }`.
When a view declares it and the format is `json`, `ToolOutput.render` budgets
the value first (§1), serialises it, then wraps the **text** in one
`untrusted(field, json, source)` fence — so the payload stays valid JSON
between the fence tags and is never double-encoded. Text-format output is
unchanged (views fence their own text). This slot sets `untrusted:
{ field: 'payload', source: 'glitchtip-event' }` on the `events` views
(`src/toolsets/events/`, a one-line change per view) and on the `issues`
list/detail views that return event-derived fields in JSON.

**The convention every toolset follows** (phase 2 specs name the source per
field and the `untrusted` declaration per JSON view):

| `source` | Use it for | Examples |
|---|---|---|
| `glitchtip-event` | anything that can arrive through a DSN or the ingest path, i.e. written by whoever holds a public key | event titles, messages, stack frames, breadcrumbs, tags, user reports, release versions (auto-created from events), log bodies and attributes, transaction and span names |
| `glitchtip-user` | text a GlitchTip account holder writes about themself or as themself | member and user names, e-mail addresses, comments |
| `glitchtip-config` | configuration an organization member or a CI job sets through the API or UI | monitor names and URLs, status page names, alert recipient URLs (after masking), release refs, commits, deploys, repositories, release-file names and headers, SSO app names and URLs, debug-file metadata |
| `external` | text a third party produced and GlitchTip relays | test-delivery error messages from webhook endpoints, Stripe product text |

When one view mixes origins, the most exposed wins: `glitchtip-event` over
`external` over `glitchtip-user` over `glitchtip-config`. A raw body of unknown
origin (the `api_get` escape hatch) is `glitchtip-event`.

### 6. Conditional write registration — `src/toolsets/toolset.ts`, `src/mcp/toolset.registry.ts`, `src/app.module.ts`

`ToolsetDefinition` gains an optional `writeEnabled?: (config: AppConfig) => boolean`.
The registry's signature becomes **`selectToolsets(config: AppConfig,
toolsets: readonly ToolsetDefinition[] = TOOLSETS)`** — the config is passed
whole, so a predicate can read any key; the second parameter exists for tests
only. It registers a toolset's `write` classes only when `config.readOnly` is
false **and** `writeEnabled` is absent or returns true. `AppModule.forRoot`
calls `selectToolsets(config, options.toolsets)`; `AppModuleOptions` gains a
test-only `toolsets?: readonly ToolsetDefinition[]`, next to `fetch`. Needed by
the `api_request` toolset (FEAT-20260925-015, `GLITCHTIP_API_REQUEST_ALLOW_WRITE`).
Toolsets that do not set it behave exactly as today.

### 7. Client surface for phase 2 — `src/glitchtip/glitchtip.client.ts`, `src/glitchtip/pagination.ts`

- **Response headers on pages [Decided by spec author].** `Page<T>` gains
  `readonly headers: Headers` — the list response's headers — so a toolset can
  read `X-Hits` (logs, FEAT-20260925-011) or any other list header without a
  client change. `nextCursor` stays as is.
- **Raw call.** `client.raw(operation, method, path, { query?, body?, headers?, timeoutMs? })
  → Promise<{ status: number; headers: Headers; text: string }>` for callers
  whose path is not in the typed snapshot (FEAT-20260925-015). Same policy as
  every call: the timeout per attempt, retries for GET/HEAD only (D-13),
  `redirect: 'manual'`, the `Authorization` header. `path` is resolved against
  the instance URL and the built URL is asserted before sending: its origin
  equals the instance origin and its pathname starts with the instance prefix +
  `/api/`; otherwise an `invalid` error and no request. Caller `headers` may not
  set `authorization`, `host` or `cookie`. Any HTTP status is **returned**, not
  mapped (the caller maps non-2xx with `errorFromResponse`, which stays
  exported); only transport failures throw (`timeout`, `unreachable`). The body
  is read as text, the token is scrubbed from it with `instance.redact` before
  it is returned, and it is **not parsed**.
- **Per-call timeout.** `call`, `page` and `raw` accept an optional
  `{ timeoutMs }` that replaces the configured `GLITCHTIP_TIMEOUT_MS` for that
  call's attempts (bounded 100 ms – 600 s like the config key). Configuration
  stays a single key; the override exists for large uploads (FEAT-20260925-014).
- **Multipart bodies.** openapi-fetch 0.17.0 passes a `FormData` body through
  unchanged and lets `fetch` set the boundary [Confirmed: pinned in
  `package.json`; the worker verifies with one client test]. The client test
  proves a `FormData` POST reaches the mock with a `multipart/form-data`
  content type and the part intact.

### 8. Tests that must not break as toolsets land — `test/**`

Three tests use a not-yet-available toolset and break as soon as that toolset
ships: `test/protocol/registration.spec.ts` (≈ line 116: derives the first
`available: false` toolset from the registry and throws when there is none —
true once phase 2 is done), `test/support/harness.spec.ts` (≈ line 43: boots
`alerts` and `monitors` and expects their "not yet available" warnings), and
`test/process/spawn.spec.ts` (≈ line 120: `organizations,alerts`, expects
"not yet available" on stderr). **[Decided by spec author]**:

- the two in-process tests boot with a **test-only injected registry**
  (`AppModuleOptions.toolsets`, §6) in which the named toolset is
  `available: false` with no controllers, through a `toolsets` option added to
  the boot helpers in `test/support/boot.ts`;
- the spawned-process test cannot inject a registry: it drops `alerts` and
  proves "logs go to stderr" with the configuration warning it already expects
  (`GLITCHTIP_TOKEN is not set`); the "not yet available" line stays covered in
  process.

`test/support/mock-glitchtip.ts` records `bodyBytes: Uint8Array` (read once
with `arrayBuffer()`) in addition to `body` (the same bytes decoded as UTF-8),
so upload tests can gunzip a chunk and split a multipart body.

## Acceptance criteria

1. `applyJsonBudget` unit tests: array over budget → valid JSON with `truncated`, `returned`, `total`, the longest fitting prefix; object with a large array property → property shrunk, `truncated: true`; an object whose large array sits three levels deep → that array shrunk and the top-level `status` and `nextCursor` kept; nothing fits → the minimal wrapper. Every output passes `JSON.parse` and fits the budget (property test over random sizes and depths).
2. `applyBudget` unit test: a cut inside a fenced block ends with `</untrusted>` before the marker; a cut outside fences is unchanged from today.
3. Protocol test with `GLITCHTIP_TOOLSETS=organizations`: `list_organizations` with `format: "json"`, 300 mocked organizations and `MCP_RESPONSE_BUDGET=2000` returns text that `JSON.parse` accepts, with `truncated: true`.
4. Protocol test: a mocked `get_organization` response with `projects: null`, where `organizationDetailView` throws while **constructing** the view (in the factory, before `render` is reached), returns `isError` with the `malformed` message naming `get_organization` (not "Internal error"), and the log line carries the error id. A second test where the throw happens inside `text()` gives the same result through `render`.
5. Client test: a list endpoint answering `{}` raises `malformed`; a non-JSON 200 body raises `malformed` (formerly `upstream`).
6. Token-safety suite still green. In `src/toolsets/**`, only the `untrusted` declaration lines of the `events` and `issues` views change (plus nothing else in any toolset directory).
7. `untrusted()` with and without the `source` argument: default output byte-identical to today's; the argument sets the attribute.
8. JSON output of an `untrusted`-declared view: the text between the fence tags passes `JSON.parse`; the whole result is not a JSON string literal; an `events` protocol test proves it, with `source="glitchtip-event"`.
9. Registry test: `selectToolsets(config)` with a toolset whose `writeEnabled` is `() => false` contributes no write controllers even with `readOnly: false`; one reading a config key sees the whole config; one without it is unchanged.
10. Client tests: `page()` returns the response headers (an `X-Hits` header is readable); `raw()` returns a 404 as `{ status: 404, text }` without throwing, scrubs the token from `text`, refuses a path that resolves to another origin or outside `/api/` with no request, never follows a 302, and retries a GET 503 but not a POST 503; a `timeoutMs` override of 200 ms times out a 500 ms mock while the configured timeout is 15 s; a `FormData` body arrives multipart.
11. Client test: a typed call whose path parameter is `..` is refused with no request (segment-count guard). `pathSegmentParam` unit tests: `""`, `.`, `..`, `...`, `a/b`, `a\b`, `a%2Fb`, a control character → refused; `1.0.0+build 5` accepted.
12. `ToolErrorFilter` test: a malformed error's log line contains no configured token or `MCP_AUTH_TOKEN` even when the thrown message contains them.
13. `registration.spec.ts`, `harness.spec.ts` and `spawn.spec.ts` pass with **every** toolset marked available (proved by running them against an injected registry where all are available, or by construction) and no longer name `alerts` or `monitors`.
14. `MockGlitchTip` records `bodyBytes`; a gzip body round-trips through it.
15. `docs/tools/` unchanged except the events/issues notes on JSON fencing (`docs/tools/events.md`, `docs/tools/issues.md`); README "Output" section (or the Configuration notes) states in one line that JSON results stay valid under the budget.

## Risks

- Toolsets merged before this fix (organizations, projects, issues, events)
  already guard their own views; this change is additive and does not alter
  their text output under budget.
- `render`'s new optional argument and `selectToolsets`' new signature must not
  change any existing behaviour — covered by the unchanged protocol suites.
- A `TypeError` from a genuine bug in this server's own code now reads as
  "GlitchTip returned a response this server did not expect". Accepted: the
  error id and the logged stack still identify it, and the agent's next step
  (look at the raw payload) is the right one either way.
- `schemaPath` in openapi-fetch middleware and the RPC data shape in mcp-nest
  are [Unknown] until verified; each has a stated fallback.

## Parallel plan

| Slot | Owns | Touches | Depends on | Lead | Model |
|---|---|---|---|---|---|
| bug-json | the fixes above | `src/format/**`, `src/glitchtip/**`, `src/mcp/**`, `src/app.module.ts`, `src/toolsets/toolset.ts`, the `untrusted` declaration lines in `src/toolsets/events/*` and `src/toolsets/issues/*` views, `test/support/**`, `test/protocol/registration.spec.ts`, `test/process/spawn.spec.ts`, `test/protocol/output-budget.spec.ts`, their specs, `README.md` (one line), `docs/tools/events.md`, `docs/tools/issues.md` | FEAT-20260925-001, -002, -003 merged | no | opus |

## Contention

Wave 0 runs this slot alone.

| Resource | Owner | Everyone else |
|---|---|---|
| `src/format/**`, `src/glitchtip/**`, `src/mcp/**`, `src/app.module.ts`, `src/toolsets/toolset.ts` | bug-json | every toolset slot: never |
| `test/support/**`, `test/protocol/registration.spec.ts`, `test/process/spawn.spec.ts` | bug-json | every toolset slot: never; after this row they no longer depend on any toolset's availability |
| the `untrusted` declaration lines of the `events` and `issues` views, `docs/tools/events.md`, `docs/tools/issues.md` | bug-json | FEAT-20260925-002/-003 are merged; nobody else opens them |
| `README.md` | bug-json (one line) | toolset slots never edit README |
| `src/config/**` | nobody in wave 0 | FEAT-20260925-014 owns it in wave 1, FEAT-20260925-015 in wave 3 |
