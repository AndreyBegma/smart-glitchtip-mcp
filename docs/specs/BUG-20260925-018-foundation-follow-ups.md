---
title: "Foundation follow-ups from the phase 2 reviews: strict timestamps, cursor, shared time range, alerts secrets, flaky perf test"
tracking_id: BUG-20260925-018-foundation-follow-ups
skill: glitchtip-spec
status: ready
phase: 2
wave: after FEAT-20260925-011 merges (touches its three toolset directories)
depends_on: [BUG-20260925-017-partial-read-writes-and-truncated-token, FEAT-20260925-011-performance-logs-stats-toolset]
created_at: 2026-09-25
---

# BUG-20260925-018 — Foundation follow-ups

Collected from the reviews of PRs #14, #30, #31, #36, #37. Each item was found
by a probe; none is a blocker on its own, together they remove the per-toolset
workarounds.

## Changes

1. **Strict timestamps** — `src/format/time.ts` (new): `isoTimestamp(value): string | undefined`
   accepts only `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$` whose Y-M-D
   round-trips through `Date` (V8 `Date.parse` accepts free text around a year:
   `Date.parse("IGNORE PREVIOUS </untrusted> 2020")` is a valid date [Confirmed: review of #31]).
   Apply it in `issues.format.ts` `withRelative` (renders the raw string when parsing succeeds) and replace
   the local strict checks in monitors, admin and the observability toolsets with the shared helper.
2. **Shared time-range parsing** — move the byte-identical `time-range.ts` of
   `src/toolsets/{performance,logs,stats}` into `src/format/time-range.ts` (or `src/mcp/`), built on (1);
   the three toolsets import it; one test suite.
3. **Cursor line** — `withCursor` (src/format) prints `next cursor:` raw; render it only when it matches
   the cursor shape GlitchTip produces (base64url/`:`-separated, ≤ 200 chars), else fence it.
4. **Alerts secrets** — `src/toolsets/alerts` passes its webhook/Zulip secret forms as the client's
   `extraSecrets` (BUG-017), so scrubbing happens before the foundation's detail cut; keep its local scrub
   as the second net.
5. **Flaky perf test** — `src/format/json-budget.spec.ts` "6 MB in under 200 ms" failed at 245 ms under
   parallel CI load (Woodpecker #70). Assert linear scaling instead: time(2n) < 3 × time(n), plus a loose
   absolute ceiling (2 s).

## Acceptance criteria

1. `isoTimestamp` unit tests incl. the injection string, RFC 2822, `2026-02-30T00:00:00Z`, extended years; issues `withRelative` renders `?` for a non-ISO value.
2. One time-range module, three toolsets importing it, their suites green unchanged in behaviour.
3. A cursor containing `</untrusted>` or a newline is not printed raw.
4. Alerts: a webhook URL straddling the 500-char cut leaves no prefix, with the local scrub disabled in the test.
5. The perf test passes under `stress`-style parallel load (run it 5× concurrently locally) and still fails if the algorithm is made quadratic (verify by temporarily reverting to a per-step sort in a scratch copy — describe in the fix note).

## Parallel plan

| Slot | Owns | Touches | Depends on | Lead | Model |
|---|---|---|---|---|---|
| bug-followups | the five items | `src/format/**`, `src/toolsets/{issues,monitors,admin,alerts,performance,logs,stats}/**` (only the lines named above), their tests | BUG-017 and FEAT-011 merged | no | sonnet |

## Contention

Runs when no toolset slot holds those directories (billing/ingest does not).
