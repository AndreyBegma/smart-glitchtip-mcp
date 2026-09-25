---
title: "Foundation: neutralise control and invisible characters in untrusted text; one shared flatten"
tracking_id: BUG-20260925-016-untrusted-control-characters
skill: glitchtip-spec
status: ready
phase: 2
wave: any (touches only src/format and src/mcp/tool-params.ts, which no toolset slot writes)
depends_on: [BUG-20260925-006-foundation-json-budget]
created_at: 2026-09-25
---

# BUG-20260925-016 — Control characters in untrusted text

## Summary

`untrusted()` (`src/format/untrusted.ts`) escapes `&` and `<` and nothing
else. Reviews of PRs #19 and #20 showed C0 controls (`\u0000`), ANSI escapes
(`\u001b[31m`), DEL, C1 controls (`\u0085`), zero-width characters, bidi
overrides and BOM passing through inside fences [Confirmed: review probes].
They do not break the fence, but they can hide or reorder text an agent (or a
person reading a transcript in a terminal) sees — the classic prompt-smuggling
tools. Every toolset also ships its own `flatten`, each with a different
character class [Confirmed: `src/toolsets/issues/issues.format.ts:237` and
the per-toolset copies in phase 2 PRs].

## Changes

1. **`src/format/sanitize.ts`** (new): `neutralise(text, { keepNewlines })`
   replaces, with one space per run:
   - C0 controls except `\n` (and `\t`, which becomes a space) when
     `keepNewlines`, all of C0 otherwise;
   - DEL and C1 (`\u007f-\u009f`);
   - zero-width and joiners (`​-‍`, `⁠`, `﻿`);
   - bidi controls (`‪-‮`, `⁦-⁩`, `‎`, `‏`);
   - line/paragraph separators ` `, ` ` → `\n` when `keepNewlines`,
     space otherwise.
   `flatten(text)` = `neutralise(text, { keepNewlines: false })` collapsed to
   single spaces and trimmed. Exported from `src/format/` as **the** flatten.
2. **`untrusted()`** applies `neutralise(text, { keepNewlines: true })` before
   escaping. Multi-line fences (event sections) keep their newlines.
3. **`table.ts`** cell flattening uses the shared `flatten`.
4. **`pathSegmentParam`** (`src/mcp/tool-params.ts`) also refuses C1 controls,
   ` `, ` `, bidi and zero-width characters.
5. Toolset-local `flatten` functions are **not** removed in this row (their
   files belong to merged or live toolset slots); a later cleanup may point
   them at the shared one. Behaviour converges anyway because every fence now
   neutralises.

## Acceptance criteria

1. Unit tests for `neutralise`/`flatten` over each character class above, with and without `keepNewlines`.
2. `untrusted()` output for a payload containing every class contains none of them; `\n` survives; `</untrusted>` is still escaped; the default output for plain ASCII is byte-identical to today.
3. `pathSegmentParam` refuses `a\u0085b`, `a b`, `a‮b`, `a​b`; accepts a unicode letter segment (`版本-1`).
4. All existing suites green without edits outside `src/format/**`, `src/mcp/tool-params.ts` and their tests.

## Parallel plan

| Slot | Owns | Touches | Depends on | Lead | Model |
|---|---|---|---|---|---|
| bug-ctrl | the four changes | `src/format/**`, `src/mcp/tool-params.ts`, their tests | BUG-20260925-006 merged | no | sonnet |

## Contention

| Resource | Owner | Everyone else |
|---|---|---|
| `src/format/**`, `src/mcp/tool-params.ts` | bug-ctrl | toolset slots never edit them (their never-lists already say so) |
