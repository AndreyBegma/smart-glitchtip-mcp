---
title: "Partial reads no longer overwrite GlitchTip data; secrets are redacted before the error-detail cut"
skill: "glitchtip-fixer"
tracking_id: "BUG-20260925-017-partial-read-writes-and-truncated-token"
status: "patched"
source_bug_report: "docs/specs/BUG-20260925-017-partial-read-writes-and-truncated-token.md"
created_at: "2026-09-25"
pr_url: "https://github.com/AndreyBegma/smart-glitchtip-mcp/pull/34"
---

# Fix Summary: Partial-read writes and the truncated-token leak

## 1. Source Bug Report

There is no separate bug report. The specification
[`docs/specs/BUG-20260925-017-partial-read-writes-and-truncated-token.md`](../specs/BUG-20260925-017-partial-read-writes-and-truncated-token.md)
is both the report and the plan, written from audit probes against a mocked
GlitchTip. Issue #33. AGENTS.md rule 15 (read-then-write never fills gaps)
landed with the spec.

## 2. Scope

1. **Token leak through the 500-character detail cut** — every toolset, via
   `GlitchTipClient`.
2. **Read-then-write tools that overwrite what a partial read did not
   return**: `update_project`, `update_project_key`, `add_release_commits`
   (a missing text field, and a non-string id that was dropped — deleted — from
   the replacing list).

## 3. Out of Scope

- **The alerts toolset adopting `extraSecrets`.** `src/toolsets/alerts/` is
  outside this slot's fence. Alerts keeps its own scrub (whole forms, plus a
  trailing start of 6+ characters) after the client's; it is still correct,
  because the client now cuts only text in which the token is already
  redacted, but its webhook forms are still cut before alerts scrubs them.
  Passing `extraSecrets: secrets` on its calls would move that scrub before
  the cut. Follow-up.
- `update_release` — already refuses on a partial read; it is the pattern
  these fixes follow and is unchanged.

## 4. Root Cause Verification

### Confirmed root cause

Each was reproduced by a regression test run red against the unpatched code
before the fix (numbers from that run):

1. **Truncate-then-redact.** `detailOf()` cut GlitchTip's detail at 500
   characters; `GlitchTipClient.perform` redacted the result afterwards, and
   `ResolvedInstance.redact` matched only the whole token. A token straddling
   the cut survived as a prefix. [Confirmed: `glitchtip.client.redaction.spec.ts`
   — 7 of 9 red; e.g. token at offset 475 left `tok_T3stS3cr3tValue_9f8e7`
   (25 of 26 characters) in `detail`; the django-ninja list form left
   `tok_T3stS3cr3`.]
2. **`update_project`** sent `current.slug`/`platform`/`eventThrottleRate`/`name`
   as read; a field absent from the GET went as `undefined`, i.e. left out of
   the full-replace `PUT` and cleared. [Confirmed: 4 red, one per field — the
   `PUT` was sent.]
3. **`update_project_key`** read `current.name`, but GlitchTip's canonical
   field is `label`. A GET with only `label` cleared the label on a
   rate-limit-only update; a GET without `rateLimit` cleared it on a
   label-only update. [Confirmed: 3 red.]
4. **`add_release_commits`** re-sent a stored `undefined` message/author as
   `''` (overwrite), and filtered out stored commits with a non-string id
   before the replacing `POST` (deletion), reporting it as "Skipped".
   [Confirmed: 4 red — one per field, and the non-string id.]

Total before the fix: 18 red regression tests (7 client + 11 toolset).

### Rejected hypotheses

None. The spec's claims held against the code.

### Remaining unknowns

Whether any real GlitchTip version omits these fields from its responses:
django-ninja serialises every field of a response schema, so the refusals
should be rare in practice. They exist so that a rare case is a clear error,
not silent data loss.

## 5. Files Changed

| Path | Change |
|---|---|
| `src/glitchtip/redactor.ts` | New. `Redactor(token, extraSecrets)` holds the secrets' forms in a private field (`toJSON` hides them). Each secret is matched as written, JSON-escaped, and JSON-escaped with non-ASCII as `\uXXXX` (either hex case). Extra secrets shorter than 8 characters are ignored; the token never is. `redact(text)` replaces every whole occurrence, merging overlapping matches into one `[redacted]`; `redactCutEnd(text)` replaces a trailing start of 4+ characters (6+ for a secret that parses as a URL, so "Enter a valid URL: https" survives). |
| `src/glitchtip/instance.context.ts` | `redactor(extraSecrets)` returns a `Redactor` of the token plus the extras. The old `redact()` had no callers left and is removed. |
| `src/glitchtip/glitchtip.errors.ts` | `errorFromResponse` takes a **required** `Redactor`. `detailOf` redacts each string first — a string detail, or every string inside a validation-error list, before it is stringified — and runs `redactCutEnd` on a string GlitchTip cut itself (ends in `…` or `...`). A list is then stringified and redacted again; the cut at 500 comes last and is followed by `redactCutEnd` → `…`. `redactCutEnd` runs only where a cut happened. |
| `src/glitchtip/glitchtip.client.ts` | `CallOptions.extraSecrets`. `perform` builds the redactor (token + extras) and passes it to `errorFromResponse` and to the post-hoc message redaction; `page` and `raw` scrub headers (and `raw` the body) with it. `redacted`/`redactedHeaders` became module functions taking the redactor. |
| `src/toolsets/projects/projects.mutations.ts` | `update_project` builds the `PUT` body, then refuses when any of `name` (text), `slug`/`platform` (text or null) or `eventThrottleRate` (number or null) is missing or of the wrong type, naming the field and the parameter that supplies it. `notPreserved()` builds that message for both project tools. Description says so. |
| `src/toolsets/projects/project-keys.mutations.ts` | `update_project_key`: label is the `label` arg, else the first of `current.name`/`current.label` that is text, else `null` if either is `null`; refuses when neither is usable, or when `rateLimit` is missing or not `{window, count}`/`null` and not given. |
| `src/toolsets/releases/release-commits.merge.ts` | New, pure. `mergeCommits(stored, inputs)`: refuses on a non-string stored id, or on a stored field that is neither text nor `null` for a commit the caller does not send again; otherwise dedups (first position, last values) and merges. Extracted because `releases.mutations.ts` was at 493 lines. |
| `src/toolsets/releases/releases.mutations.ts` | `add_release_commits` calls `mergeCommits`; the "Skipped" path is gone. 493 → 455 lines. |
| `src/glitchtip/glitchtip.client.redaction.spec.ts`, `src/glitchtip/redactor.spec.ts` | New tests (see §10). |
| `test/protocol/projects-mutations.spec.ts`, `test/protocol/projects-keys.spec.ts`, `test/toolsets/releases/mutations.spec.ts` | Regression tests (see §10). |
| `docs/tools/projects.md`, `docs/tools/releases.md` | Document the refusals. |

## 6. Behaviour Before

- A 400/422 whose detail carried the token (or, for alerts, a webhook URL)
  across the 500th character returned a prefix of it to the agent.
- The four write paths above reported success after overwriting or deleting
  GlitchTip data they had not read.

## 7. Behaviour After

- The token, and any `extraSecrets`, are removed before the cut; no start of
  4+ characters survives at the end of a detail at any offset.
- Each write path refuses with `isError: true` and **no write request**:
  `Not updated: GlitchTip's response did not include slug, so its current
  value cannot be preserved; pass \`new_slug\` explicitly or retry.` —
  `Not attached: stored commit 1 has an id that is not a string, so the list
  cannot be re-sent without deleting it. Nothing was changed.` A full read
  behaves exactly as before; a `null` in the read is re-sent as `null` (`''`
  for commits).

## 8. MCP Surface Impact

- Tool names and input schemas: unchanged.
- Descriptions of `update_project` and `add_release_commits` gain one
  sentence on the refusal.
- Output: the four paths can now return a refusal; `add_release_commits` no
  longer emits "Skipped N previously stored commit(s) with a non-string id."
  (that case is now a refusal).
- A detail containing a secret's start may be up to 6 characters longer than
  before (`[redacted]` replacing a 4-character start before the `…`).

## 9. Why This Is the Minimal Safe Patch

The redaction moves to the one place error text is built, and the redactor
is a required argument there, so no future caller maps an error unredacted.
The refusals are local to each tool's body construction. The commit merge
extraction was forced by the 500-line ceiling, and moved the existing merge
logic unchanged apart from the refusal.

## 10. Tests Added or Updated

- `glitchtip.client.redaction.spec.ts` (9): token and `extraSecrets` at every
  offset that straddles the cut, for 400 and 422 (gate token-safety); whole
  extra secret in a short detail; the django-ninja list form; a start
  GlitchTip cut itself; no change without a secret; `raw` body and headers.
- `redactor.spec.ts` (4): longest-first, empty secrets ignored, the 4-character
  floor, no secret in `JSON.stringify`.
- `projects-mutations.spec.ts` (+6): refusal per missing field with only a
  `GET` sent; a missing field the caller gives is sent; a read `null` is
  re-sent as `null`.
- `projects-keys.spec.ts` (+3): label-only read keeps the label on a
  rate-limit-only update (acceptance 3); refusal with neither name nor label;
  refusal with no `rateLimit`.
- `releases/mutations.spec.ts`: the "skips a non-string id … Skipped" test is
  **changed** to expect a refusal with no `POST` (spec §2); +3 refusal per
  missing field; +1 a partial stored commit the caller sends again is
  accepted. The ">1000" test's fixture gains `authorName: null,
  authorEmail: null` — without them it is a partial read under rule 15 and
  would stop at the refusal before reaching the limit it tests.

## 11. Checks Run

`bun run lint`, `bun run typecheck`, `bun run test` (71 files, 1032 tests
passed), `bun run build` — all green.

## 12. Manual Verification Performed

None against a real instance: no GlitchTip instance or token is available to
this worker. All verification is against the mocked HTTP layer.

## 13. Risks and Possible Regressions

- A GlitchTip version that genuinely omits one of these fields would turn a
  working update into a refusal. The message names the parameter to pass, so
  the agent can proceed; no data is lost either way.
- `redactCutEnd` runs only where a text was cut (by this server, or by
  GlitchTip with `…`/`...`). A message GlitchTip cut without any mark, ending
  in a start of the token, is not caught — accepted in review to avoid
  redacting ordinary text. Text that is cut right after the first 4+
  characters of the token is shown as `[redacted]`. Cosmetic.

## Review round (orchestrator verification of #34)

No blockers; all eight points are fixed on the branch, each with a test:
`page()` headers honour `extraSecrets`; JSON- and `\uXXXX`-escaped forms are
matched, and list-detail strings are redacted before stringifying; the
trailing scrub runs only at a cut, with a 6-character floor for URL secrets;
extra secrets under 8 characters are ignored; overlapping matches merge; a
wrong-typed field in the read refuses in `update_project` and
`update_project_key` as it does in `add_release_commits`; the commit refusal
reads "returned author_name as something other than text or null"; the
unused `ResolvedInstance.redact()` is removed. Suite after: 71 files, 1032
tests.

## 14. Follow-Up Work

- Alerts: pass `extraSecrets` to the client on its calls (see §3).

## 15. PR

https://github.com/AndreyBegma/smart-glitchtip-mcp/pull/34 (closes #33).

## 16. Verifier Instructions

- Re-run `src/glitchtip/glitchtip.client.redaction.spec.ts`,
  `src/glitchtip/redactor.spec.ts`, `test/protocol/projects-mutations.spec.ts`,
  `test/protocol/projects-keys.spec.ts`, `test/toolsets/releases/mutations.spec.ts`,
  and `test/security/token-safety.spec.ts`.
- Challenge: any path that builds a `GlitchTipError` from GlitchTip text
  without the redactor (`errorFromResponse` is the only mapper; `raw` returns
  text, not errors); a secret split across the cut in a JSON-escaped form;
  `mergeCommits` order and dedup against the pre-fix behaviour.
- Pass: every red test above green, no write request on any refusal, full
  suite green.
