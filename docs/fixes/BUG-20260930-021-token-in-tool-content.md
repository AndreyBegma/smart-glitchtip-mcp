---
title: "API token echoed in GlitchTip success content: scrubbed by the client before any view"
skill: "glitchtip-fixer"
tracking_id: "BUG-20260930-021-token-in-tool-content"
status: "patched"
source_bug_report: "docs/bug-reports/2026-09-30-token-in-tool-content.md"
created_at: "2026-09-30"
pr_url: ""
---

# Fix Summary: API token echoed in GlitchTip success content

## 1. Source Bug Report

[`docs/bug-reports/2026-09-30-token-in-tool-content.md`](../bug-reports/2026-09-30-token-in-tool-content.md),
issue #48. Gate: token-safety.

## 2. Scope

The API token (the env one over stdio, the per-request `Authorization: Bearer` one over HTTP)
in a 2xx GlitchTip body — any string, any key — never reaches a tool result, a resource or a
prompt, in `text` or `json`, whole or as a 4+ character start left by a view's field cap or the
response budget.

## 3. Out of Scope

- Extra secrets (webhook URLs, license keys, heartbeat URLs) in success bodies: they stay the
  toolset's to scrub where it renders them, as before.
- Free-text redaction of anything else an application logs (D-20 is unchanged).
- The bug report's `status`: set by the orchestrator on `develop` after the merge.

## 4. Root Cause Verification

### Confirmed root cause

[Confirmed] Hypothesis 1: `GlitchTipClient.perform` returned `result.data` untouched on 2xx;
every foundation `redact()` sat on a failure branch (and in `raw()`), and `ToolOutput` has no
connection handle. [Confirmed] Hypothesis 2 (PR #47 review): views cap fields before `render`
(exception value 1 000, message 2 000, breadcrumb 300, context line 160), so the scrub has to
run on the parsed response, not on rendered text. The new protocol test fails on every case
with the client scrub disabled (11/11) and passes with it.

### Rejected hypotheses

- A scrub in `ToolOutput.render` (the report's suggested direction): it would meet a
  pre-capped prefix (hypothesis 2), and it needs the connection's redactor threaded through 141
  call sites. Rejected for the client, which owns redaction (rule 13), holds the connection's
  `ResolvedInstance`, and runs before every view.
- A JSON stringify → redact → parse round-trip on every response (FEAT-019's
  `scrubResponse`): measured 5–8× slower than a walk on large payloads (section 11).

### Remaining unknowns

None for the fix. A real GlitchTip instance was not used (section 12).

## 5. Files Changed

| Path | Reason |
|---|---|
| `src/glitchtip/scrub.ts` (new) | `scrubSecrets(value, redactor)`: copy-on-write walk over strings, array items, object keys and values; a clean response comes back by identity. |
| `src/glitchtip/glitchtip.client.ts` | `perform` scrubs the 2xx body with the connection's token-only redactor (covers `call` and `page`); new `CallOptions.writeBack`. |
| `src/mcp/resource-read.ts`, `src/toolsets/{issues,events}/*.resources.ts` | FEAT-019's `scrubResponse` folded into the client scrub and removed; `readText`'s whole-token text scrub stays as the second net. |
| `src/toolsets/alerts/alerts.store.ts`, `src/toolsets/projects/projects.mutations.ts`, `src/toolsets/admin/admin.mutations.ts`, `src/toolsets/monitors/monitors.mutations.ts`, `src/toolsets/releases/releases.mutations.ts` | `writeBack: true` on the six read-then-write reads (section 7). |
| `src/toolsets/admin/user-update.payload.ts` | The unknown-option refusal quotes a GlitchTip-written key from the now-unscrubbed read; the key is redacted before it is named. |
| `docs/tools/logs.md`, `docs/tools/resources.md` | The server's own token is the one thing removed from log bodies; the resource scrub is now the client's. |

## 6. Behaviour Before

`get_issue` with the token in the title returned `title: …leaked tok_SECRET_123 here…`; the same
for any read whose view renders a GlitchTip-written string (event message, exception value,
breadcrumb, context line, release ref, log line, list tables), over both transports.

## 7. Behaviour After

Every 2xx body is scrubbed of the token in `GlitchTipClient.perform`, before any view, so no field
cap or budget cut can leave a start of it. `raw()` (api_request, ingest) already scrubbed its text
and is unchanged; `page()` headers were already redacted.

**Read-then-write (rule 15), `CallOptions.writeBack`.** A read whose values are re-sent to
GlitchTip by a full-replace write takes the body unscrubbed, so a token stored in a re-sent field
goes back as it was instead of `[redacted]` overwriting GlitchTip's value. Default is scrubbed;
the option is opt-in per call and documented as "re-sent to GlitchTip, never rendered". A failure
of a `writeBack` call is redacted like every other (the failure branch is unchanged; unit test).
Audit of the six sites — in each, the tool result comes from the (scrubbed) write response and
no error message quotes a value of the read:

| Site | Re-sent from the read | Result from | Error messages built from the read |
|---|---|---|---|
| `readAlert` (`update_project_alert`, `add_alert_recipient`, `remove_alert_recipient`, `test_project_alert`) | scalars, every recipient (URL, Zulip config) | write response (`test_project_alert`: the test call's scrubbed page) | ids and field names only; the read also feeds the `extraSecrets` scrub list, which must be the stored values |
| `update_project` | name, slug, platform, eventThrottleRate | write response | field and parameter names only (`notPreserved`) |
| `update_current_user` | name, options | write response, through `renderRedacted` | field names; an unknown option key is named only as a plain identifier — **now redacted first** (it was the one site that quoted GlitchTip text) |
| `update_monitor` | name, type, url, expected status/body, interval, timeout, threshold, project | write response | field names and fixed text; heartbeat id/URL stay `extraSecrets` of the PUT |
| `update_release` | ref, dateReleased | write response | fixed text |
| `add_release_commits` | every stored commit | write response | positions and parameter names only |

## 8. MCP Surface Impact

None: no tool name, input schema or annotation changed. Output differs only where GlitchTip
content contained the token, which now reads `[redacted]`.

## 9. Why This Is the Minimal Safe Patch

One scrub in the one place every typed GlitchTip response passes (rule 13), instead of 141 render
call sites; one opt-out, used by exactly the reads rule 15 needs it for. The toolset-level scrubs
(api_request, admin, alerts, ingest, monitors) are untouched and keep carrying extra secrets.

## 10. Tests Added or Updated

- `test/security/success-token-safety.spec.ts`: the token in an issue title (`get_issue`,
  `list_issues`), an event exception value straddling the 1 000-character cap, message,
  breadcrumb and context line (`get_latest_event`), a release ref (`get_release`), a log line
  (`list_logs`); `text` and `json`; stdio with the env token and HTTP with a per-request Bearer
  token. A window of offsets puts the token under a 1 000-character `MCP_RESPONSE_BUDGET` cut
  (and asserts the cut did fall there). Assertion: neither the token nor its first 4 characters
  appear. All 11 fail with the client scrub disabled.
- `test/security/write-back-token-safety.spec.ts`: per site, the token in a re-sent field → the
  write body carries the original value, and neither the result (`text`, `json`) nor a failed
  write's error carries a 4-character start of the token; the `update_current_user` refusal does
  not name a token-valued option key. The six re-send tests fail with `writeBack` ignored; the
  refusal test fails without the key redaction.
- `src/glitchtip/scrub.spec.ts` (FEAT-019's `scrubResponse` tests moved here, plus identity and
  copy-on-write); `src/glitchtip/glitchtip.client.redaction.spec.ts`: `call` and `page` bodies
  scrubbed, token only, `writeBack` returned as read, a `writeBack` failure still redacted.

## 11. Checks Run

- `bun run lint` — clean (379 files).
- `bun run typecheck` — clean.
- `bun run test` — 134 files, 2 017 tests passed.
- `bun run build` — clean.

**Cost of the scrub, measured.** Node 24.21, a synthetic event (stack frames with 11 context
lines each, 100 breadcrumbs, 30 tags), token-only redactor, mean of 100 runs after 20 warm-ups:

| Payload | JSON round-trip (`scrubResponse`) | `scrubSecrets` |
|---|---|---|
| 28 KiB | 0.106 ms | 0.023 ms |
| 286 KiB | 1.26 ms | 0.147 ms |
| 2 066 KiB | 14.6 ms | 2.41 ms |

The walk adds ~2.4 ms to a 2 MiB response, against a 15 s request timeout.

## 12. Manual Verification Performed

None against a real instance: no credential for one here. The e2e check in the bug report (§14,
`mcp-e2e` organization) is still to be run.

## 13. Risks and Possible Regressions

- A read-then-write added later without `writeBack` writes `[redacted]` back over a stored token.
  It fails safe for rule 1 (no leak) and loses only a value that held the token.
- A read that derives a scrub list from GlitchTip data without `writeBack` (admin's license key
  link) gets a list whose entries may carry `[redacted]` in place of the token — still no leak;
  the token itself is scrubbed.
- A token shorter than 4 characters: the redactor still removes it whole; the "no 4-character
  start" property is the same one BUG-017 established.

## 14. Follow-Up Work

- The e2e manual check (section 12).

## 15. PR

Filled in when opened.

## 16. Verifier Instructions

- Bug report: `docs/bug-reports/2026-09-30-token-in-tool-content.md`.
- Re-run `test/security/success-token-safety.spec.ts`, `test/security/write-back-token-safety.spec.ts`,
  `src/glitchtip/scrub.spec.ts`, `src/glitchtip/glitchtip.client.redaction.spec.ts`, and the
  existing `test/security/*`, `test/toolsets/{alerts,admin,api_request,ingest,monitors}` scrubs.
- Challenge: any `client.call`/`client.page` whose data is re-sent and lacks `writeBack`; any
  `writeBack` read whose values reach a result or error; any GlitchTip response that reaches a
  view without going through `perform` (only `raw()`, which redacts its text).
- Pass: no token or 4-character start in any tool/resource result for any read; write bodies of
  the six sites carry the stored value unchanged.
