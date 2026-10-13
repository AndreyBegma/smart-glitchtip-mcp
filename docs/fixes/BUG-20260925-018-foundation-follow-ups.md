---
title: "Foundation follow-ups: strict timestamps, shared time range, cursor line, alerts extraSecrets, flaky perf test, invisible format characters, noRetry"
skill: "glitchtip-fixer"
tracking_id: "BUG-20260925-018-foundation-follow-ups"
status: "patched"
source_bug_report: "docs/specs/BUG-20260925-018-foundation-follow-ups.md"
created_at: "2026-09-30"
pr_url: ""
---

# Fix Summary: Foundation follow-ups

## 1. Source

The specification
[`docs/specs/BUG-20260925-018-foundation-follow-ups.md`](../specs/BUG-20260925-018-foundation-follow-ups.md)
is both the report and the plan; issue #39. Each item came from a review probe
of PRs #14, #30, #31, #36, #37, #43 and #44.

## 2. What changed

| # | Item | Change |
|---|---|---|
| 1 | Strict timestamps | New `src/format/time.ts`: `isoTimestamp(value)` accepts only a strict ISO 8601 date-time with a mandatory zone whose Y-M-D exists on the calendar. `issues.format.ts` `withRelative` renders `?` for anything else (and no longer prints an unchecked raw string); monitors and admin use the shared helper instead of their local regexes. |
| 2 | Shared time range | The byte-identical `time-range.ts` of performance, logs and stats moved to `src/format/time-range.ts` (built on item 1); the three toolsets import it; the three duplicate suites became one (`src/format/time-range.spec.ts`). |
| 3 | Cursor line | `withCursor` prints the cursor bare only when it matches `^[A-Za-z0-9:._=+/-]{1,200}$`; anything else is fenced with `untrusted('cursor', …)`. |
| 4 | Alerts secrets | `writeAlert`, `create_project_alert` and the recipient delete pass the toolset's `secrets` as the client's `extraSecrets`, so redaction happens before the foundation's 500-character detail cut. The local scrub stays as the second net. |
| 5 | Flaky perf test | The "6 MB in under 200 ms" assertion is replaced by a scaling one: `time(2n) < max(3 × time(n), 50 ms)` plus a 2 s ceiling. |
| 6 | Invisible format characters | `HIGH_INVISIBLE_AND_BIDI_CLASS` gains `\p{Cf}` (soft hyphen U+00AD included); the regexes built from it carry the `u` flag, so `neutralise` and `pathSegmentParam` both cover it. |
| 4b | Short alerts secrets | The client drops `extraSecrets` under 8 characters by default. Alerts keeps URL-derived forms of any length (an ntfy topic `/s3cr3t`), so it also passes the new `keepShortExtraSecrets: true`, which lifts the floor for that call. What the foundation covers: a secret of any length is redacted whole before the detail cut, and a cut-off start of 4+ characters (6+ for a URL) after it; a 1–3 character start of a short secret is not redacted, as it is too common to tell from ordinary text. The ntfy case is tested at every offset across the cut in `cut-redaction.spec.ts`. |
| 7 | No-retry option | `CallOptions.noRetry` on `raw()` and `page()`/typed calls: no 429/5xx retry and no `Retry-After` sleep. `verifyEventVisible` sets it on every poll. |

## 3. Behaviour changes an agent can see

- `\p{Cf}` (item 6) also removes tag characters U+E0020–E007F, Arabic number
  signs U+0600–0605 and U+FFF9–FFFB. This is intended (ASCII-smuggling
  defence), and `pathSegmentParam` refuses them.

- An issue timestamp that is not strict ISO 8601 renders `?` instead of the raw
  string. Monitors and admin already fenced/gapped free text; the shared rule
  is stricter than their local ones were, so a value with no time zone (or, in
  admin, a date-only or space-separated one) is now fenced/gapped there too.
  GlitchTip's API writes zoned ISO 8601 date-times.
- A cursor that is not base64url-shaped is shown fenced rather than raw.
- No tool name or input schema changed.

## 4. Verification

- New/changed tests: `src/format/time.spec.ts`, `src/format/time-range.spec.ts`,
  `src/format/format.spec.ts` (cursor), `src/format/sanitize.spec.ts` and
  `src/mcp/tool-params.spec.ts` (U+00AD and a `\p{Cf}` sample),
  `test/toolsets/issues/malformed.spec.ts`,
  `test/toolsets/alerts/cut-redaction.spec.ts`,
  `src/glitchtip/glitchtip.client*.spec.ts` (`noRetry`),
  `test/toolsets/ingest/verify.spec.ts`.
- **AC4** — `cut-redaction.spec.ts` mocks the alerts local `scrub` to a no-op,
  so only the client-level `extraSecrets` can be redacting; no prefix of the
  webhook URL or its secret (4+ characters) survives. The older
  `review.spec.ts` cut test no longer asserts the text *ends* in
  `[redacted]…`: the whole secret is now redacted before the cut, so the cut may
  land inside the marker itself (`[redacte…`), which is harmless.
- **AC5** — the budget spec run 5× concurrently: 5 of 5 green. Quadratic
  sensitivity checked in the working tree by temporarily adding a per-push
  `entries.sort(...)` to `MaxHeap.push` in `json-budget.ts` (reverted; the file
  is unchanged in this PR): the test failed with `time(n)=1436 ms, time(2n)=5031 ms`
  (3.5×, over the 3× bound).
- **AC7** — a mocked 429 with `Retry-After: 10` and `wait_seconds = 2`, on a
  real clock and a client with no injected sleep, finishes inside
  `wait_seconds + 1 s`.

## 5. Not verified

Nothing against a live GlitchTip instance; none was needed.
