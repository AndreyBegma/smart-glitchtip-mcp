---
title: "API token echoed in GlitchTip content reaches tool results unredacted"
tracking_id: "BUG-20260930-021-token-in-tool-content"
skill: "glitchtip-bug-report"
status: "ready-for-fix"
severity: "high"
confidence: "high"
created_at: "2026-09-30"
glitchtip_version: "unknown (not version-dependent)"
transport: "both"
issue_url: ""
---

# Bug Report: API token echoed in GlitchTip content reaches tool results unredacted

## 1. Summary

The GlitchTip API token is removed from **error** bodies, but not from **successful** responses. When GlitchTip content contains the token, for example an issue title or an event message written by an application that logged its own configuration, a read tool returns the token verbatim. That breaks `AGENTS.md` rule 1: "never returned in a tool result". It was found while implementing FEAT-20260925-019 (PR #47).

## 2. Observed Behaviour

[Observed] The FEAT-019 worker set the configured token to `tok_SECRET_123` and had the mocked GlitchTip return an issue whose title was `leaked tok_SECRET_123 here`. The body of `get_issue` then contained:

```
title: <untrusted …>leaked tok_SECRET_123 here</untrusted>
```

This happened in `test/toolsets/issues/resources-output.spec.ts` ("a token echoed in an issue title"), before PR #47 added a local scrub to the resource helper. The resource body is by construction identical to `get_issue`'s text, so the tool leaks the same way.

## 3. Expected Behaviour

No tool result contains the token in any form the `Redactor` recognises, in either format (`text` or `json`) and on either transport. The same applies to the per-request `Authorization: Bearer` token in HTTP mode (D-03, D-05). No prefix of the token may survive the budget cut (the same property BUG-017 established for error details).

## 4. Actual Behaviour

[Confirmed] Successful responses flow from `GlitchTipClient` through a view into `ToolOutput.render`. The `Redactor` is not applied anywhere on that path, apart from a few toolsets that call it themselves.

## 5. Reproduction Steps

1. Configure `GLITCHTIP_URL` (mock) and `GLITCHTIP_TOKEN=tok_SECRET_123` (stdio), or pass `Authorization: Bearer tok_SECRET_123` in HTTP mode.
2. Make the mock return `GET /api/0/organizations/<org>/issues/42/` with `title: "leaked tok_SECRET_123 here"`.
3. Call `get_issue` with `{ "issue_id": 42 }`, in both `format: "text"` and `format: "json"`.
4. The result contains `tok_SECRET_123`.

The same shape applies to any read whose view renders GlitchTip-written strings. Examples: `get_latest_event`/`get_event` (message, breadcrumbs, context), `list_issues`, release and log tools.

## 6. Relevant Documentation

- `AGENTS.md` rule 1 (token never leaves); rule 13 (the client owns error mapping); rule 14 / D-18 (GlitchTip content is untrusted data).
- D-03, D-09: token handling and redaction.
- D-12: output budget. A scrub after the cut can leave a prefix.
- `docs/specs/BUG-20260925-017-partial-read-writes-and-truncated-token.md`: the same class of problem on the error path.
- `docs/specs/FEAT-20260925-019-resources.md` AC11: requires resource text to be clean. PR #47 meets it locally in `src/mcp/resource-read.ts`.

## 7. Code Evidence

- [Confirmed] `src/glitchtip/glitchtip.errors.ts:167,186`: the error body and detail are redacted.
- [Confirmed] `src/glitchtip/glitchtip.client.ts:171` redacts the response text only on the failure branch. `:333-342` redacts the error message, the detail and the copied headers.
- [Confirmed] `src/format/tool-output.ts:59-94`: `ToolOutput` is a singleton that holds only `AppConfig`. `render()` runs `applyBudget`/`applyJsonBudget` and has no access to the connection's `Redactor`.
- [Confirmed] `src/glitchtip/instance.context.ts:48`: `redactor()` is available per connection. It is what error paths and a few toolsets use.
- [Confirmed] Toolsets that scrub success content themselves:
  - `src/toolsets/api_request/api-response.ts:57`
  - `src/toolsets/api_request/redact-body.ts`
  - `src/toolsets/admin/admin.calls.ts:91`
  - `src/toolsets/ingest/ingest.mutations.ts:148,213`
- [Confirmed] Toolsets that do not, for example `src/toolsets/issues/issues.tools.ts:179`: `this.output.render(args.format, issueDetailView(issue))`.
- [Confirmed] Scope: there are 141 `.render(` call sites across 39 non-spec source files.

## 8. API / Contract Evidence

No GlitchTip contract is involved. Any string field GlitchTip returns can carry the token, because the reporting application (any DSN holder) writes it (D-18). The tool input schemas are unaffected.

## 9. Suspected Failure Layer

- output formatting for agents (`src/format/tool-output.ts`)
- auth / token (per-request Bearer token in HTTP mode)
- test gap (no test puts the token in success content)

## 10. Root Cause Hypotheses

1. **Redaction was designed for the error path only.** Confidence: high.
   - Evidence: section 7. Every foundation `redact()` call sits on a failure branch, and `ToolOutput` has no connection handle.
   - How to verify: add a protocol test with the token in an issue title and in an event message, for `text` and `json`. It fails on `develop`.
2. **[Hypothesis] Some views pre-shorten strings (flatten/cap) before `render`.** If so, a scrub inside `ToolOutput` may meet only a prefix of the token.
   - Evidence: BUG-017 found this shape on the error path.
   - How to verify: grep the views for caps, and probe with the token straddling a cap.

## 11. Severity Assessment

- Security: token disclosure to the agent and to anything the agent's output reaches, such as transcripts, logs or other tools. The token grants the scopes of the GlitchTip API key.
- Frequency: it requires the token to appear in GlitchTip content. That is uncommon, but it is realistic when an application logs its config or environment, or echoes an `Authorization` header into an error message.
- Recoverability: rotate the token.
- Data loss: none.
- Severity: high. It breaks a rule that is never traded away, and nothing mitigates it at runtime.

## 12. Recommended Fix Direction

Apply one scrub at the output boundary rather than in each toolset:
- `ToolOutput.render` (or an overload the tools already reach) takes the connection's `Redactor`.
- It redacts the rendered text before `applyBudget`, and redacts string values before `applyJsonBudget`, so no prefix survives the cut.
- It stays safe when a view has already capped a string (hypothesis 2).
- The `Redactor` must be the connection's, so the per-request HTTP Bearer token is covered.
- Keep the existing toolset-level scrubs; they carry extra secrets.
- Once the shared scrub exists, the local scrub PR #47 added to `src/mcp/resource-read.ts` can be folded into it.

The change touches every `render` call site, or needs a way to thread the connection through without editing 141 sites. Choosing between those is part of the fix.

## 13. Tests Needed

- Protocol test: the token in an issue title, an event message, a breadcrumb and a release ref. The result is clean for `text` and `json`, over stdio and over HTTP with a per-request Bearer token.
- Budget test: the token straddling `MCP_RESPONSE_BUDGET`; no 4+ character prefix survives.
- Regression: the existing toolset scrubs (api_request, admin, alerts, ingest) still pass.

## 14. Manual Verification Script

Against a disposable instance only (D-14, `mcp-e2e` org): send an event whose message contains the token value, then call `get_latest_event` for its issue. Expect `[redacted]` where the token was.

## 15. Risks While Fixing

- Touching `src/format/**` and many toolset files collides with any live slot in those toolsets.
- Redacting after the budget cut reintroduces the BUG-017 prefix leak.
- Redacting inside JSON strings after serialisation can break escaping. Redact the values, not the serialised text.
- The `Redactor`'s 8-character floor for extra secrets (see BUG-018) does not apply to the token itself.

## 16. Open Questions

- [Unknown] Should the resource helper keep its local scrub as a second net after the shared fix lands? Default: fold it into the shared path, and keep the test.

## 17. Fixer Instructions

Use this bug report. Read the referenced docs. Verify the root cause before editing. Make the smallest safe patch. Add or update tests. Document what changed. Do not invent architecture. Start only after PR #47 (FEAT-20260925-019) has merged, because it owns `src/mcp/resource-read.ts`.
