---
title: "Toolset `events`"
tracking_id: FEAT-20260925-003-events-toolset
skill: glitchtip-spec
status: ready
phase: 1
depends_on: [FEAT-20260925-001-foundation]
created_at: 2026-09-25
---

# FEAT-20260925-003 — Toolset `events`

## Summary

Read events — the individual occurrences behind an issue — in a form an agent
can debug from: the exception chain with the stack trace collapsed to the
application's own frames, breadcrumbs, request, tags and runtime context. The
raw JSON stays reachable for anything the summary drops. Read-only toolset;
default-on (D-06).

Endpoint facts: `docs/reference/glitchtip-endpoints.md` §C. Scopes: every events
route accepts `event:read|event:write|event:admin` [Confirmed:
`apps/issue_events/api/events.py` at `v6.2.6`].

## GlitchTip endpoints

| Tool | Method + path |
|---|---|
| `list_issue_events` | `GET /api/0/organizations/{org}/issues/{issue_id}/events/` |
| `get_latest_event` | `GET /api/0/organizations/{org}/issues/{issue_id}/events/latest/` |
| `get_event` | `GET /api/0/organizations/{org}/issues/{issue_id}/events/{event_id}/` |
| `get_event_json` | `GET /api/0/organizations/{org}/issues/{issue_id}/events/{event_id}/json/` |
| `list_project_events` | `GET /api/0/projects/{org}/{project_slug}/events/` |
| `get_project_event` | `GET /api/0/projects/{org}/{project_slug}/events/{event_id}/` |

Events lists accept only `limit` and `cursor` — no filters exist [Confirmed].

## The event renderer — `src/toolsets/events/event.format.ts`

The event detail schema types `entries[].data` for `exception` and `message` as
a bare object [Confirmed]; the stored shape follows Sentry's
(`values[].{type, value, module, mechanism, stacktrace.frames[]}`, frames with
`filename, abs_path, function, module, lineno, colno, context_line,
pre_context, post_context, in_app, vars`) [Inferred from the ingest schema].
The renderer therefore **parses defensively**: every field optional, unknown
shapes fall back to a one-line note "exception data in an unrecognised shape —
use get_event_json", never a crash.

Rendering, in this order, each section omitted when empty:

1. **Header** — event id, date received, level, platform, `release` and
   `environment` from tags (the event schema has no release field
   [Confirmed]), `nextEventID`/`previousEventID` when present.
2. **Exception chain** — for each exception value, last (most recent) first:
   `Type: value` then frames **most recent call first**:
   - `in_app: true` frames: `  at function (filename:lineno:colno)` and the
     `context_line` trimmed to 160 chars;
   - consecutive non-in-app frames collapse into `  … N library frames …`;
   - if no frame is in-app, show the 5 most recent frames in full;
   - `vars` omitted by default; `include_vars: true` adds them, each value cut
     to 200 chars **[Decided by spec author]**;
   - `pre_context`/`post_context` only with `include_context: true`.
3. **Message** entry (formatted message), if any.
4. **Breadcrumbs** — the last 10 (`breadcrumbs: number`, 0–100, default 10):
   `time level category: message`.
5. **Request** — method, URL, and the query string; headers only with
   `include_request_headers: true`, and then `Cookie` and `Authorization`
   values are replaced with `[redacted]` always **[Decided by spec author]**.
6. **Tags** — `key=value` on one wrapped line.
7. **Context** — one line each for runtime, os, browser, device, app when
   present (name + version).
8. **User** — `id` and `email` only; IP address and geo are omitted
   **[Decided by spec author — least PII by default]**.
9. **Processing errors** (`errors[]`) if any, one line each.
10. Footer: "Full payload: get_event_json(issue_id, event_id)."

Every string that originates in the event (exception values, function names,
filenames, context lines, messages, breadcrumbs, tags, URLs) goes through
`untrusted()` (D-18) — as one fenced block per section, not per value, so the
output stays readable.

The whole result is subject to the response budget; the stack section is
trimmed last (breadcrumbs, then tags, then context go first).

## Tools

All tools: readOnly, idempotent, `openWorldHint: true`, optional
`organization`, optional `format` (`json` returns the parsed, projected event
— header, exceptions with in-app frames, breadcrumbs — not the raw payload).
Every description ends with the untrusted-data sentence used in the issues
toolset.

**`list_issue_events`** — "List events of an issue, newest first." Input:
`issue_id: number`, `limit?` 1–100 default 25, `cursor?`. Output per event:
event id, date received, title (untrusted, 120 chars), release/environment tags
when present.

**`get_latest_event`** — "Get the most recent event of an issue, with its stack
trace. Start here when debugging an issue." Input: `issue_id`, the renderer
options (`include_vars?`, `include_context?`, `include_request_headers?`,
`breadcrumbs?`).

**`get_event`** — as above for a given `event_id: string (uuid)`.

**`get_event_json`** — "Get the event payload as JSON. Large; prefer
get_event. Use `path` to extract part of it." Input: `issue_id`, `event_id`,
`path?: string` — a JSON Pointer (RFC 6901) such as `/contexts/runtime`
applied before rendering. Output: pretty JSON of the (sub)document, budgeted.
It is the raw payload **minus** three things, removed before `path` is applied
(D-20): `user.ip_address` and `user.geo` are deleted; `request.cookies` is
replaced by `"[redacted]"`; `Authorization` and `Cookie` headers are
`[redacted]` in `request.headers`, which may be an array of `[key, value]`
pairs or an object — both shapes handled, header names compared
case-insensitively. The same redaction applies to `get_event`'s request section
and to the `json` format.

**`list_project_events`** — "List the newest events of a project, across
issues." Input: `project: string` (slug), `limit?`, `cursor?`. Output as
`list_issue_events` plus the issue (group) id.

**`get_project_event`** — Input: `project`, `event_id`, renderer options.

## Errors

- 404 on an event → "Event <id> was not found for issue <issue_id>." (issue
  tools) or "Event <id> was not found in project <slug>." (`get_project_event`).
- An invalid JSON Pointer or one that matches nothing → validation error naming
  the first missing segment, no request retry.

## Acceptance criteria

1. `src/toolsets/events/index.ts` is `available: true` with read classes only; `docs/tools/events.md` documents every tool. Protocol tests pin `GLITCHTIP_TOOLSETS=events`: `whoami` plus the 6 tools.
2. Fixtures under `test/fixtures/events/` — at least: a Python error with mixed in-app/library frames, a JavaScript error with no in-app frames, a chained exception (2 values), an event with no exception (message only), and an event whose exception data is in an unknown shape. Fixtures are **synthetic** (no real payload from any instance, rule 12).
3. Renderer tests on each fixture assert: frame order (most recent first), collapse count, the no-in-app fallback of 5 frames, chain order, graceful fallback note.
4. `include_vars`, `include_context`, `include_request_headers` each change the output as specified; `Cookie`/`Authorization` are `[redacted]` in `get_event`, `get_event_json` and the `json` format.
5. User IP/geo and cookie values never appear in any tool output, `get_event_json` included; a test covers header pairs and header objects.
6. `get_event_json` with `path` returns only the subtree; an invalid pointer is a validation error.
7. Budget: with `breadcrumbs: 100`, oversized tags and context, and a small `MCP_RESPONSE_BUDGET` set in the test, the output stays under budget with the stack intact and breadcrumbs, tags, context trimmed in that order. **Section-priority trimming is implemented in `src/toolsets/events/`** (the foundation's `budget.ts` only tail-cuts, and is applied last as a safety net).
8. A context line containing `</untrusted>` is escaped (D-18).
9. Each tool has a mocked-response test and an error-path test. No new dependency.

## Risks

- **Stored exception shape is inferred**, not schema-backed. Mitigated by the
  defensive parser and the unknown-shape fixture; the e2e suite (later) checks a
  real event against the renderer.
- Some SDKs mark every frame `in_app: null`; the fallback shows the top 5.

## Parallel plan

| Slot | Owns | Touches | Depends on | Lead | Model |
|---|---|---|---|---|---|
| p1-events | toolset `events` | `src/toolsets/events/**`, `test/**/events*`, `test/fixtures/events/**`, `docs/tools/events.md` | FEAT-20260925-001 merged | no | sonnet |

The renderer is new code with no precedent in the repository, but its behaviour
is fully specified above; `sonnet` is the claim that it is. If the worker finds
the stored shape contradicting §"The event renderer", that is a `misclassified`
report, not an improvisation.

## Contention

| Resource | Owner | Everyone else |
|---|---|---|
| `src/toolsets/events/**`, `test/fixtures/events/**`, `docs/tools/events.md` | p1-events | do not open |
| `src/format/**`, `src/glitchtip/**`, `src/mcp/**`, `package.json` | nobody in phase 1 | message the orchestrator |
