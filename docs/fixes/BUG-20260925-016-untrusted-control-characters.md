---
title: "Neutralise control and invisible characters in untrusted text; one shared flatten; pathSegmentParam C1/bidi"
skill: "glitchtip-fixer"
tracking_id: "BUG-20260925-016-untrusted-control-characters"
status: "patched"
source_bug_report: "docs/specs/BUG-20260925-016-untrusted-control-characters.md"
created_at: "2026-09-25"
pr_url: ""
---

# Fix Summary: Neutralise control and invisible characters in untrusted text

## 1. Source Bug Report

There is no separate bug report. The specification
[`docs/specs/BUG-20260925-016-untrusted-control-characters.md`](../specs/BUG-20260925-016-untrusted-control-characters.md)
is both the report and the plan, written from review probes on PRs #19 and
#20. Issue #28.

## 2. Scope

All four of the spec's changes:

1. `src/format/sanitize.ts` (new): `neutralise(text, { keepNewlines })` and
   `flatten(text)`, the shared flatten.
2. `untrusted()` applies `neutralise(text, { keepNewlines: true })` before
   escaping.
3. `table.ts` cell flattening uses the shared `flatten`.
4. `pathSegmentParam` also refuses C1 controls, line/paragraph separators,
   bidi and zero-width characters.

## 3. Out of Scope

- The toolset-local `flatten` functions (e.g.
  `src/toolsets/issues/issues.format.ts`). The spec (§5) leaves them in place:
  their files belong to merged or live toolset slots, and behaviour converges
  anyway because every `untrusted()` fence now neutralises.
- Any file outside `src/format/**` and `src/mcp/tool-params.ts`.

## 4. Root Cause Verification

### Confirmed root cause

`untrusted()` (`src/format/untrusted.ts`) escaped only `&` and `<`. C0
controls (`\u0000`), ANSI escapes (`\u001b[31m`), DEL, C1 controls
(`\u0085`), zero-width characters, bidi overrides and BOM passed through
inside fences. None of these break the fence, but they can hide or reorder
text an agent — or a person reading a transcript in a terminal — sees.
[Confirmed: review probes on PRs #19 and #20, and in code — `untrusted()`
had exactly the two `.replace()` calls.] Separately, every toolset shipped
its own `flatten`, each with its own character class. [Confirmed:
`src/toolsets/issues/issues.format.ts:237` and the per-toolset copies in
phase 2 PRs.]

### Rejected hypotheses

None. The spec's claims held against the code.

### Remaining unknowns

None that block the change.

## 5. Files Changed

| Path | Change |
|---|---|
| `src/format/sanitize.ts` | New file. `neutralise(text, { keepNewlines })` collapses each contiguous run of C0 controls (all of C0 when `!keepNewlines`, C0 minus `\n` when `keepNewlines`), DEL/C1 (`\u007f`–`\u009f`), zero-width space/joiners/LRM/RLM (`​`–`‏`), bidi embeddings/overrides (`‪`–`‮`), the word joiner (`⁠`), bidi isolates (`⁦`–`⁩`) and BOM (`﻿`) to one space; a run of line/paragraph separators (` `, ` `) collapses to `\n` when `keepNewlines`, a space otherwise. `flatten(text)` is `neutralise(text, { keepNewlines: false })` with ordinary whitespace also collapsed to one space and trimmed — the shared flatten, exported from `src/format/`. |
| `src/format/untrusted.ts` | `untrusted()` runs `neutralise(text, { keepNewlines: true })` before the existing `&`/`<` escape, so a multi-line fence (event sections) keeps its newlines while every control/invisible character is gone. |
| `src/format/table.ts` | `cellText` (used by both `table()` and `keyValues()`) calls the shared `flatten` instead of its own `String(value).replace(/\s+/g, ' ').trim()`. |
| `src/mcp/tool-params.ts` | `pathSegmentParam`'s reject regex is built from `sanitize.ts`'s exported `HIGH_INVISIBLE_AND_BIDI_CLASS` and `LINE_PARAGRAPH_CLASS`, so it refuses the same character classes `neutralise` strips, in addition to the C0/DEL/`/`/`\`/`%` it already refused. The refusal message names the new classes. |
| `src/format/sanitize.spec.ts` | New. Unit tests for `neutralise`/`flatten` over each character class, with and without `keepNewlines` (AC1). |
| `src/format/format.spec.ts` | Adds a test that an `untrusted()` payload carrying every character class contains none of them afterwards, keeps `\n`, and still has exactly one closing fence tag (AC2); adds a `table()` test that a cell's control/invisible characters are neutralised. |
| `src/mcp/tool-params.spec.ts` | Adds refusal cases for a C1 control, a line separator, a bidi override and a zero-width space, and an acceptance case for a CJK segment (AC3); the pre-existing "a slash" case's exact-message assertion is updated for the new message text. |

### A note on how these files were authored

Typing a `\uXXXX` escape for a code point above U+00FF (the zero-width, bidi
and separator characters) in a tool call in this session was silently
rendered as the actual character before the file was written, which breaks a
JS regex *literal* (U+2028/U+2029 are line terminators in source text
outside string/template literals). `sanitize.ts` therefore builds its
character classes from `String.fromCharCode` at module load and constructs
the regexes with `new RegExp(...)`, so the source file itself stays plain
ASCII; `tool-params.ts` reuses those same assembled class fragments rather
than re-deriving them. The test files' string literals use the actual
characters directly (valid in a string/template literal since ES2019); each
one was verified byte-for-byte against its intended code point before it was
trusted.

## 6. Behaviour Before

- `untrusted()` fenced text with only `&` and `<` escaped. C0/C1 controls,
  DEL, zero-width characters, bidi overrides/isolates and BOM passed through
  unchanged, inside the fence.
- `table()`/`keyValues()` cells only collapsed ordinary whitespace
  (`/\s+/g`); the same invisible/control characters passed through.
- `pathSegmentParam` refused `/`, `\`, `%`, `.`/`..`, C0 controls and DEL, but
  accepted a C1 control, a line/paragraph separator, a bidi override or a
  zero-width character in a path segment.
- Every toolset had its own `flatten`, each with a different, narrower
  character class than the others.

## 7. Behaviour After

- `untrusted()` neutralises every control/invisible character listed above
  before escaping `&`/`<`; multi-line fences keep their newlines; for text
  with none of these characters (the plain ASCII case), the output is
  byte-identical to before.
- `table()`/`keyValues()` cells go through the same shared `flatten`, so a
  cell with an embedded control or invisible character renders as ordinary
  spaces instead of passing the character through.
- `pathSegmentParam` refuses a C1 control, a bidi override or isolate, a
  zero-width character, or a line/paragraph separator, with a message naming
  the reason; a unicode letter segment (e.g. `版本-1`) still passes.
- The toolset-local `flatten` functions are untouched (out of scope, §3);
  their outputs converge with the shared one in practice because every fence
  they feed now neutralises regardless.

## 8. MCP Surface Impact

- **Tool names and input schemas are unchanged.**
- **Output shape changes for text containing these characters only.** A
  fenced or tabled value that used to carry a raw control/invisible
  character now carries a space (or, for line/paragraph separators inside a
  fence, a newline) instead. Plain ASCII output is unaffected (AC2's
  byte-identical assertion).
- **Input validation is stricter.** A release version, or any other
  `pathSegmentParam` input, that contains a C1 control, a bidi
  override/isolate, a zero-width character or a line/paragraph separator is
  now refused with a Zod validation error before any request is sent, where
  it previously passed through. No tool that used `pathSegmentParam` before
  this change had a legitimate use for such a value (§ spec, AC3).

## 9. Why This Is the Minimal Safe Patch

Every change is exactly the one the spec names, at the layer the spec names.
`neutralise`/`flatten` are new, additive functions; `untrusted()`'s only
change is one extra transform ahead of the existing escape, gated so plain
ASCII text is untouched; `table.ts`'s change swaps one inline regex for the
shared function it now matches; `pathSegmentParam`'s reject set grows using
the same source-of-truth ranges `neutralise` uses, so the two can't drift.
No toolset file, test, or registry was touched.

## 10. Tests Added or Updated

| AC | Test |
|---|---|
| 1 | `src/format/sanitize.spec.ts`: each character class collapses a run to one space, with and without `keepNewlines`; tab/newline interaction under `keepNewlines`; line/paragraph separators map to `\n` or space; plain ASCII and CJK are untouched. `flatten` collapses control/invisible runs and ordinary whitespace together, and trims. |
| 2 | `src/format/format.spec.ts`: an `untrusted()` payload carrying one of every class contains none of them afterwards, `\n` survives, and `</untrusted>` inside the payload is still escaped (one real closing tag). The pre-existing "byte-identical to before" test for plain ASCII (acceptance 7 of BUG-006) still passes unchanged. |
| 3 | `src/mcp/tool-params.spec.ts`: `pathSegmentParam` refuses a C1 control (`a\u0085b`), a line separator, a bidi override, and a zero-width space, each with a message naming "bidi/invisible characters"; accepts a CJK segment (`版本-1`). |
| 4 | `bun run test`: all 645 tests across 47 files pass, including every existing suite under `src/format/**`, `src/mcp/**` and `test/toolsets/**` (the `events`, `issues`, `members` and `teams` toolsets present on this branch), with no edit outside this slot's owned paths. |

## 11. Checks Run

```
bun run lint       # biome check: 159 files, no findings
bun run typecheck  # tsc --noEmit: clean
bun run test       # vitest unit project: 47 files, 645 tests, all pass
bun run build      # tsc -p tsconfig.build.json: clean
```

## 12. Manual Verification Performed

None against a real instance. No credential was available, and tests never
reach one (AGENTS.md rule 12). Every path is exercised through unit tests
against the pure functions in `src/format/**` and `src/mcp/tool-params.ts`.

## 13. Risks and Possible Regressions

- **A JSON-fenced view could, in a rare case, stop being parseable JSON.**
  `ToolOutput.json()` (`src/format/tool-output.ts`) wraps a view's serialised
  JSON in `untrusted()` when the view declares an `untrusted` field.
  `JSON.stringify` is permitted by RFC 8259 to leave ` `/` `
  unescaped inside a string value, and does so in current engines. If an
  event field contains one of those characters, `neutralise(..., {
  keepNewlines: true })` now turns it into a raw `\n` before the JSON is
  fenced — and a raw, unescaped newline inside a JSON string is invalid per
  RFC 8259. This is an existing gap the spec's unconditional `untrusted()`
  change surfaces; no test in this repository currently exercises a JSON
  view with a ` `/` ` in a string value, and this fix does not add
  one, since acceptance criterion 2 is about the text fence, not this
  specific JSON interaction. Flagging it here rather than silently
  special-casing the JSON path, which the spec does not ask for. A follow-up
  row can decide whether JSON views should exempt line/paragraph separators
  from `neutralise`, or escape them post-serialisation instead.
- **Toolsets not present on this branch.** The brief noted that the
  `releases` and `uploads` toolsets are live in other worktrees. Neither is
  merged into `develop` as seen from this branch, so there was no toolset
  test to check against a verbatim-control-character assertion. If either
  lands with such an assertion before this PR merges, its test will need the
  same treatment BUG-20260925-006 gave `test/toolsets/events/event.format.spec.ts`
  — updated in that toolset's own PR, not here.

## 14. Follow-Up Work

- Point the toolset-local `flatten` functions at the shared one (spec §5,
  deferred by the spec itself to a later cleanup, not this row).
- Decide whether JSON-fenced views should treat line/paragraph separators
  differently from the text fence (§13).

## 15. PR

See the pull request that closes #28.

## 16. Verifier Instructions

**Changed files:** §5.

**Re-run:** `bun run test`, focusing on:

- `src/format/sanitize.spec.ts`
- `src/format/format.spec.ts`
- `src/mcp/tool-params.spec.ts`

**Challenge:**

1. Does `neutralise` miss a code point in any of the six classes the spec
   names? Check the exact boundaries: `\u009f`/` `, `‏`/`‐`,
   `‮`/` `, `⁩`/`⁪`.
2. Is the "one space per run" behaviour actually one space, not one per
   character, across a long run and across adjacent characters from
   different classes?
3. Does `pathSegmentParam`'s new reject set actually reuse `sanitize.ts`'s
   ranges, or could the two silently drift?
4. Does any toolset test elsewhere in the repository assert a control
   character survives verbatim through `untrusted()`, `table()` or
   `keyValues()`? (None found in this branch's `test/toolsets/**`.)
5. Read §13's JSON-fencing risk and judge whether it is acceptable to ship
   as a known gap or should block this PR.

**Pass criteria:**

- All four checks are green.
- Acceptance criteria 1–4 hold.
- `untrusted()`'s output for plain ASCII input is unchanged (AC2).
