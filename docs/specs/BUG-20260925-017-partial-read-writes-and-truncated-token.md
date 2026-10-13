---
title: "Partial reads silently overwrite GlitchTip data; the token leaks through the 500-char detail cut"
tracking_id: BUG-20260925-017-partial-read-writes-and-truncated-token
skill: glitchtip-spec
status: ready
phase: 2
wave: any (touches src/glitchtip, src/toolsets/projects, src/toolsets/releases — no live slot writes them)
depends_on: [BUG-20260925-006-foundation-json-budget]
created_at: 2026-09-25
---

# BUG-20260925-017 — Partial-read writes and the truncated-token leak

## Summary

An audit of the merged toolsets (after the same class was found in the alerts and
releases reviews) confirmed, with probes against a mocked GlitchTip:

1. **The API token leaks through the foundation's detail cut** (rule 1).
   `detailOf()` truncates GlitchTip's error detail to 500 characters
   (`src/glitchtip/glitchtip.errors.ts:151`) **before** `GlitchTipClient.perform`
   redacts it (`glitchtip.client.ts:177`), and redaction matches only the whole
   token (`instance.context.ts:44`). A 400 whose detail has the token starting at
   character 495 returned `…xxxtok_T…` [Confirmed: probe]. Every toolset is
   affected.
2. **Read-then-write tools overwrite fields a partial read did not return**
   (rule 7 — the call reports success) [Confirmed: probes]:
   - `update_project` (`src/toolsets/projects/projects.mutations.ts:180-182`):
     a GET without `platform`/`eventThrottleRate`/`slug` sends a PUT that clears
     them (`ProjectIn` is full-replace).
   - `update_project_key` (`project-keys.mutations.ts:133-134`): reads
     `current.name`, but the response's canonical field is `label`; a response
     with only `label` clears the label on a rate-limit-only update; a missing
     `rateLimit` clears it on a label-only update.
   - `add_release_commits` (`src/toolsets/releases/releases.mutations.ts:385-387`):
     a stored commit missing `message`/`authorName`/`authorEmail` is re-sent with
     `''`, overwriting the stored value (the POST replaces the whole list).
   - `add_release_commits` (`:375, :430`): a stored commit whose `id` is not a
     string is dropped from the replacing POST — **deleted** on GlitchTip — while
     the result says "Skipped".
   `update_release` already does it right (refuses when a field it must re-send
   is absent) and is the pattern.

## Changes

1. **Redact before truncating** (`src/glitchtip/glitchtip.errors.ts`,
   `glitchtip.client.ts`): `errorFromResponse` receives the instance's redactor
   and applies it to the raw detail and message **before** any cut; after the
   cut, any trailing prefix (≥ 4 chars) of a known secret that ends at the cut is
   also replaced. Add an optional `extraSecrets: string[]` to the per-call options
   so a toolset holding its own secrets (alerts webhook URLs, invite links) can
   have them scrubbed at the same point, before the cut.
2. **Refuse partial reads, never default** — the rule for every read-then-write:
   a field the write must re-send that is `undefined` in the read, and not
   supplied by the caller, refuses the call before any write, naming the field
   ("GlitchTip's response did not include <field>; pass it explicitly or retry").
   An explicit `null` in the read is re-sent as `null`.
   - `update_project`: all of `name`, `slug`, `platform`, `eventThrottleRate`.
   - `update_project_key`: `name` is `current.name ?? current.label`; refuse if
     both are undefined and the caller gave no label; refuse if `rateLimit` is
     undefined and the caller gave none.
   - `add_release_commits`: `null` message/author → `''` stays; `undefined` →
     refuse; a stored commit with a non-string `id` → refuse the whole call
     (never drop it). The existing test that locks in "Skipped" is changed.
3. **AGENTS.md rule** (orchestrator lands it with this spec): read-then-write
   tools refuse on a partial read.

## Acceptance criteria

1. Client test: a 400/422 detail with the token starting at characters 490–499 (every offset) never contains any 4+ character prefix of the token; same for `extraSecrets`.
2. Probes from the audit as tests: each of the four write paths with a partial GET makes **no write request** and returns an error naming the field; a full GET behaves as today.
3. `update_project_key` with a response carrying only `label` keeps the label on a rate-limit-only update.
4. Token-safety suite and all toolset suites green.

## Parallel plan

| Slot | Owns | Touches | Depends on | Lead | Model |
|---|---|---|---|---|---|
| bug-partial | the fixes above | `src/glitchtip/**`, `src/toolsets/projects/**`, `src/toolsets/releases/**`, their tests, `docs/tools/projects.md`, `docs/tools/releases.md` | BUG-006 merged | no | opus |

## Contention

| Resource | Owner | Everyone else |
|---|---|---|
| `src/glitchtip/**`, `src/toolsets/projects/**`, `src/toolsets/releases/**` | bug-partial | live wave-2 slots (alerts, monitors, observe) do not open them |
