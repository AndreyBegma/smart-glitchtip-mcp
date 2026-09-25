---
title: "Foundation output fixes: valid JSON under the budget, fence-aware cut, malformed responses as agent errors, the phase 2 client surface"
skill: "glitchtip-fixer"
tracking_id: "BUG-20260925-006-foundation-json-budget"
status: "patched"
source_bug_report: "docs/specs/BUG-20260925-006-foundation-json-budget.md"
created_at: "2026-09-25"
pr_url: ""
---

# Fix Summary: Foundation output fixes

## 1. Source Bug Report

There is no separate bug report. The specification
[`docs/specs/BUG-20260925-006-foundation-json-budget.md`](../specs/BUG-20260925-006-foundation-json-budget.md)
is both the report and the plan. It was written from three adversarial
reviews, with probes. Issue #13.

## 2. Scope

All of spec §1–§8:

- JSON budgeting.
- The fence-aware text cut.
- Malformed responses mapped to an agent error.
- The fence `source` label.
- Fenced JSON views.
- `writeEnabled`.
- The client surface for phase 2: page headers, `raw()`, per-call timeouts,
  multipart bodies and the path-segment guard.
- Test hardening.

## 3. Out of Scope

- Every toolset change other than the five `untrusted` declaration lines. The
  spec (AC6) and the brief limit it to those.
- Configuration keys, dependencies and `src/bootstrap.ts`. None of them is in
  this slot's fence.

## 4. Root Cause Verification

### Confirmed root cause

1. **JSON cut as text.** `ToolOutput.render` passed `JSON.stringify(view.json())`
   through `applyBudget`, so an over-budget JSON result ended in the
   truncation marker and could not be parsed. [Confirmed in code.]
2. **Text cut inside a fence.** `applyBudget` cut on the last newline before
   the room. It had no knowledge of `<untrusted>` fences, so the marker could
   end up inside an open fence. [Confirmed in code.] A hard cut of a line
   with no newline could also leave half a fence tag.
3. **An unexpected response shape became "Internal error".** `ToolErrorFilter`
   sent every non-agent-facing error to the internal-error branch.
   `GlitchTipClient.page()` returned `result.data ?? []` without checking
   that the value was an array. Two consequences followed:
   - a list endpoint that answered `{}` gave an object where items were
     expected;
   - an answer of `undefined` read as an empty list, a failure that looked
     like an empty result.

   [Confirmed in code.]

### Spec [Unknown]s, resolved

- **openapi-fetch 0.17.0 passes `schemaPath` to `onRequest` middleware.**
  [Confirmed] `MiddlewareCallbackParams.schemaPath` holds the template, braces
  included. `defaultPathSerializer` applies `encodeURIComponent`, so `/`, `\`
  and `%` stay inside one segment. Only a value of `.` or `..` can change the
  segment count, because URL parsing collapses it (a percent-encoded `%2e%2e`
  collapses too). The segment-count guard therefore catches exactly the
  dangerous cases.
- **mcp-nest's RPC data carries the tool name.** [Refined] It does not.
  `switchToRpc().getData()` returns only the tool's arguments. The
  `tools/call` request, which holds `params.name`, is `McpContext.args[1]`,
  exposed as the `mcpRequest` getter on `switchToRpc().getContext()`. The
  filter reads the name from there, and falls back to "this call".

### Refinement (approved by the orchestrator)

In `render`, the second layer does not throw an agent-facing error.
`ToolErrorFilter` passes an agent-facing error through without logging it,
so the stack and the error id would be lost. `render` throws a
`MalformedViewError` instead. That error is not agent-facing and carries the
operation name and the original error as its `cause`. The filter maps
`TypeError`, `RangeError` and `MalformedViewError` to the same `malformed`
message with an error id, and logs the stack and its cause through
`redactSecrets`.

### Rejected hypotheses

None. Every claim in the spec held against the code.

### Remaining unknowns

None that block the change. See §13 for the one known cost.

## 5. Files Changed

**Format**

| Path | Change |
|---|---|
| `src/format/json-budget.ts` | New file. `applyJsonBudget` as spec §1: keeps the longest array prefix inside a wrapper; for an object, keeps top-level scalars and shrinks the largest node at any depth; falls back to a minimal wrapper. |
| `src/format/budget.ts` | Fence-aware cut (§2): closes an open fence before the marker, drops a partial tag left by a hard cut, and stays within the budget. |
| `src/format/tool-output.ts` | `render(format, view, operation = 'this call')`. JSON goes through `applyJsonBudget` and text through `applyBudget`. Adds `View.untrusted` fencing for JSON (§5), `MalformedViewError` and `isShapeError`. |
| `src/format/untrusted.ts` | Optional `source` argument (§4), default `glitchtip-event`. Adds the `UntrustedSource` type and the source convention. |
| `src/format/result.ts` | Removes `json()`, which no longer had a caller once `render` serialises JSON itself. |

**GlitchTip client**

| Path | Change |
|---|---|
| `src/glitchtip/glitchtip.errors.ts` | Adds the `malformed` kind. `malformedResponseError()` moves to that kind; its message is unchanged. Adds `malformedListError(operation)` and `refusedRequestError(reason)`. |
| `src/glitchtip/pagination.ts` | `Page<T>.headers` (§7). |
| `src/glitchtip/request-guards.ts` | New file: `pathSegmentGuard` middleware, raw URL resolution and assertion, and the caller-header check. |
| `src/glitchtip/glitchtip.client.ts` | `page()` refuses a non-array body and returns headers. `raw()` added. `{ timeoutMs }` on `call`, `page` and `raw`, bounded to 100 ms – 600 s. The segment guard is registered on every typed-API instance. |

**MCP layer, registration and toolsets**

| Path | Change |
|---|---|
| `src/mcp/tool-error.filter.ts` | `malformed` branch. The tool name comes from the MCP context. The logged cause chain goes through `redactSecrets`. |
| `src/mcp/tool-params.ts` | `pathSegmentParam(label, maxLength)` (§3). |
| `src/mcp/toolset.registry.ts` | New signature `selectToolsets(config, toolsets = TOOLSETS)`. Adds `writeEnabled`. |
| `src/toolsets/toolset.ts` | `writeEnabled?: (config: AppConfig) => boolean`. |
| `src/app.module.ts` | `selectToolsets(config, options.toolsets)`. Adds the test-only `AppModuleOptions.toolsets`. |
| `src/toolsets/events/event.format.ts` | One `untrusted` declaration line on each of the three views. Nothing else changes. |
| `src/toolsets/issues/issues.format.ts` | One `untrusted` declaration line on `issueListView` and on `issueDetailView`. Nothing else changes. |

**Test support**

| Path | Change |
|---|---|
| `test/support/boot.ts` | `bootInMemory(env, mock, { toolsets })`. Adds `withPending(name)`. |
| `test/support/mock-glitchtip.ts` | `bodyBytes`. The body is read once. |

**Tests**

| Path | Change |
|---|---|
| `test/protocol/registration.spec.ts`, `test/support/harness.spec.ts` | Use an injected pending toolset. They no longer name `alerts` or `monitors`. |
| `test/process/spawn.spec.ts` | Drops `alerts`. Still proves that stderr receives the logs. |
| `test/protocol/events.spec.ts` | Two assertions change from "unfenced" to "one fence, parseable between the tags". |
| `test/security/token-safety.spec.ts` | The internal-defect cases now throw `Error`. Malformed twins throw `TypeError`. |
| `test/toolsets/events/event.format.spec.ts` | `headers` added to the `Page` literals. |
| New tests | `src/format/json-budget.spec.ts`, `src/glitchtip/glitchtip.client.surface.spec.ts`, `src/mcp/tool-params.spec.ts` and `test/protocol/output-budget.spec.ts`. Additions to `format.spec.ts`, `tool-error.filter.spec.ts`, `toolset.registry.spec.ts` and `glitchtip.client.spec.ts`. |

**Docs**

| Path | Change |
|---|---|
| `docs/tools/events.md`, `docs/tools/issues.md`, `README.md` | Notes on JSON fencing and on JSON staying valid under the budget. |

## 6. Behaviour Before

- A `format: "json"` result over `MCP_RESPONSE_BUDGET` was invalid JSON that
  ended in "… truncated N of M characters".
- A text cut could leave the marker inside an open `<untrusted>` fence.
- A response of an unexpected shape produced "Internal error in
  smart-glitchtip-mcp (<id>)". This covered a view reading `null`, and a list
  endpoint that answered with an object.
- A list endpoint that answered with no body produced an empty page.
- The client had no raw call, no response headers on pages, no per-call
  timeout and no path-segment guard.
- `writeEnabled` did not exist.

## 7. Behaviour After

- JSON results are always valid JSON within the budget:
  - an over-budget list becomes
    `{ truncated, returned, total, hint, items }`;
  - an over-budget object keeps its top-level scalars, with nested values
    shortened, and gains `truncated: true` and `hint`.
- A text cut inside a fence closes the fence before the marker.
- An unexpected response shape gives this message: "GlitchTip returned a
  response this server did not expect for <tool> (<id>). The request itself
  succeeded; …". The stack is logged under that id with secrets redacted.
- A list endpoint that answers with a non-array body is a `malformed` error.
  It no longer reads as an empty page.
- The JSON output of the events views and of `list_issues` and `get_issue`
  is one `<untrusted source="glitchtip-event" field="payload">` fence. The
  text between the tags is the JSON and parses as it is.
- A path parameter of `.` or `..` is refused before any request is sent.

## 8. MCP Surface Impact

- **Tool names and input schemas are unchanged.**
- **The output shape changes,** as the spec decided:
  - an over-budget JSON result becomes the truncation wrapper described
    above;
  - JSON from the events tools, `list_issues` and `get_issue` is fenced;
  - malformed responses give the `malformed` message instead of "Internal
    error";
  - a non-JSON 200 body keeps its message but changes kind from `upstream`
    to `malformed`. The kind is internal and is not shown to agents.
- An agent parsing the JSON of an events tool, `list_issues` or `get_issue`
  must now take the text between the fence tags. Inside string values, `<`
  and `&` read as `&lt;` and `&amp;`, which is the escaping `untrusted()`
  has always applied.

## 9. Why This Is the Minimal Safe Patch

Each change is the one the spec names, at the layer the spec names. The
toolsets gain only their `untrusted` declarations. The existing events
`boundedJson` notice is untouched, so the output of events tools under the
budget is unchanged apart from the fence. `render`'s new argument has a
default and `selectToolsets` keeps a default registry, so no existing call
site had to change for them.

## 10. Tests Added or Updated

| AC | Test |
|---|---|
| 1 | `src/format/json-budget.spec.ts`: prefix, first item budgeted, shallow and three-level shrink, string cut, minimal wrapper, plus a property test over 300 seeded random values (budgets from 400 to 6400; each output is parsed and must fit). |
| 2 | `src/format/format.spec.ts`: a cut inside a fence closes it; a hard cut never leaves half a tag (swept across 100 budgets); a cut outside fences is byte-identical to the old algorithm. |
| 3 | `test/protocol/output-budget.spec.ts`: 300 organizations with a budget of 2000 give parseable output with `truncated: true`. |
| 4 | `test/protocol/output-budget.spec.ts`: `projects: null` makes the view factory throw; `access: null` makes `text()` throw; both give the `malformed` message naming `get_organization`, and the log line carries the error id. A list endpoint answering with an object is also covered. |
| 5 | `src/glitchtip/glitchtip.client.surface.spec.ts` and `src/glitchtip/glitchtip.client.spec.ts`: `{}` from a list endpoint is `malformed`; a non-JSON 200 is `malformed`. |
| 6 | The token-safety suite is green, with malformed twins added on stdio and on HTTP. |
| 7 | `src/format/format.spec.ts`: the default output is byte-identical; each `source` value sets the attribute. |
| 8 | `src/format/format.spec.ts` (unit) and `test/protocol/events.spec.ts` (`get_event_json` and `get_latest_event` over MCP): the text between the tags parses, and the whole result does not parse as JSON. |
| 9 | `src/mcp/toolset.registry.spec.ts`: `() => false` gives no writes even with `readOnly: false`; read-only wins over `() => true`; the predicate sees the whole config; a toolset without the predicate is unchanged. |
| 10 | `src/glitchtip/glitchtip.client.surface.spec.ts`: `X-Hits` is readable. For `raw()`: a 404 is returned, the token is scrubbed, five path escapes are refused with no request, the prefix is kept, reserved headers are refused, a 302 is not followed, a GET 503 is retried (3 attempts) and a POST 503 is not (1 attempt). A `timeoutMs` of 200 against a 500 ms mock times out while the configured timeout is 15 s. A FormData body arrives as multipart, through both the typed and the raw path. |
| 11 | `src/glitchtip/glitchtip.client.surface.spec.ts`: `..` and `.` are refused with no request; `a/b` goes out encoded, as one segment. `src/mcp/tool-params.spec.ts` covers the refused and accepted values. |
| 12 | `src/mcp/tool-error.filter.spec.ts`: a malformed log line with the three secrets in its cause keeps none of them. |
| 13 | The registration, harness and spawn tests no longer depend on any toolset being pending. The injected `withPending` covers the "not yet available" path, and the default-toolsets test already held by construction. |
| 14 | `src/glitchtip/glitchtip.client.surface.spec.ts`: a gzip body round-trips through `bodyBytes`. |

## 11. Checks Run

```
bun run lint       # biome check: 135 files, no findings
bun run typecheck  # tsc --noEmit: clean
bun run test       # vitest unit project: all files and tests pass
bun run build      # tsc -p tsconfig.build.json: clean
```

The PR body carries the exact counts from the final run.

## 12. Manual Verification Performed

None against a real instance. No credential was available, and tests never
reach one (AGENTS.md rule 12). Every path is exercised through the mocked
HTTP layer and the in-memory MCP transport.

## 13. Risks and Possible Regressions

- **A defect in this server's own code can read as "malformed".** A
  `TypeError` from such a defect now gets the "GlitchTip returned a response
  this server did not expect" message. The spec accepted this. The error id
  and the logged stack still identify the defect.
- **Cost of `applyJsonBudget`.** The first version was quadratic: every step
  re-serialised the value and cut one string. The gate review measured 1.8 s
  for 330 × 3000-character strings and 74 s for 2000 × 3000.

  The current version works in three steps:
  1. It cuts every long string in one pass.
  2. It computes pretty-print sizes once, exactly (`prettySize`, which is
     tested against `JSON.stringify`).
  3. It keeps the sizes up to date by delta along the path it changed, and
     chooses the largest child from a lazy max-heap per container.

  Measured with `bun` on this machine at a budget of 20000:

  | Input | Before | After |
  |---|---|---|
  | `{extra: 330 × 3000}` (1 MB) | — | 4 ms |
  | `{extra: 2000 × 3000}` (6 MB) | — | 20 ms |
  | 500 nested 3000-character strings (1.5 MB) | 1069 ms | 6 ms |
  | 2000 keys × 50-item arrays | 953 ms with a per-step sort | 28 ms |
  | 5000-item list | — | 3 ms |

  Two tests hold these bounds, each under 200 ms: a 6 MB nested object, and
  600 sibling arrays.
- **Agents that parse the JSON of events or issues must read inside the
  fence.** Called out in the PR.

## 14. Gate review (PR #14 at 8348878), and what changed after it

1. **`applyJsonBudget` was quadratic.** It is now linear; see §13.
2. **Response headers reached the caller unscrubbed.** `page()` and `raw()`
   now return a new `Headers` with every value passed through
   `instance.redact`. This covers a `Location` or an echoed `Bearer`, and is
   tested for both methods.
3. **Invalid `raw()` input read as a malformed response.** `raw()` now checks
   its input before any request is built, and refuses it as `invalid`:
   - a method outside GET, HEAD, POST, PUT, PATCH and DELETE;
   - a body on GET or HEAD;
   - an invalid header name or value;
   - a body that cannot be serialised as JSON.
4. **`returned` could disagree with `items`.** A single item that shrinks to
   nothing now gives `{ returned: 0, total }`, and `returned` always equals
   `items.length`.
5. **Top-level scalars were all or nothing.** Long top-level strings are cut,
   and each top-level scalar that fits is kept.
6. **`describe()` could overflow on a cyclic cause chain.** It now walks the
   chain iteratively, stops at 5 causes, and detects cycles.
7. **Fence counting could be fooled by look-alike tags.** It now matches only
   the exact tags that `untrusted()` writes, in order. In `issues`:
   - `get_issue` and `assign_issue` fence a project name that has no slug, and
     the assignee name;
   - the `list_issues` table shows only the project slug and `team:<slug>` or
     `<type>:<id>`. Table cells are cut at 80 characters and would split a
     fence.
8. **Events.** The stale "unfenced" comments are updated:
   - `boundedJson` measures the fenced, escaped form, so a payload just under
     the budget gets `TRUNCATED_NOTICE` consistently;
   - `renderEventDetailJson` is given the budget less the fence overhead.
9. **`raw()` paths and headers.**
   - Paths may not contain `%2F`, `%5C` or `%2E`, in any case.
   - These request headers are reserved: `Proxy-Authorization`,
     `Forwarded`, `X-Forwarded-*` and `X-Real-IP`.

**Behaviour change, kept.** `page()` reports a 204 or an empty 200 on a list
endpoint as `malformed`, where it used to return `[]`. This is tested.

## 15. Follow-Up Work

- **`bootHttp` has no registry injection.** It goes through
  `src/bootstrap.ts`, which is outside this slot's fence. No current test
  needs it.

## 16. PR

See the pull request that closes #13.

## 17. Verifier Instructions

**Changed files:** §5.

**Re-run:** `bun run test`, focusing on:

- `src/format/*.spec.ts`
- `src/glitchtip/glitchtip.client.surface.spec.ts`
- `src/mcp/tool-error.filter.spec.ts`
- `test/protocol/output-budget.spec.ts`
- `test/security/token-safety.spec.ts`

**Challenge:**

1. Can a fenced JSON result exceed the budget? Consider escape expansion in
   `ToolOutput.json` and the `room <= 0` exit.
2. Can `applyBudget` still leave an open fence? Consider a text with several
   fences and a hard cut.
3. Does anything in `raw()` send a request to a URL off the instance's
   origin, or outside `/api/`? Consider `//host`, `\\host`, `%2e%2e` and
   instance path prefixes.
4. Does any new path log, return or throw a token? The areas to check are
   the body of `raw()`, `MalformedViewError`'s cause, and error messages.
5. Can `writeEnabled` return writes in read-only mode?

**Pass criteria:**

- All four checks are green.
- Acceptance criteria 1–14 hold.
- No secret appears in any result or log line produced by the suite.
