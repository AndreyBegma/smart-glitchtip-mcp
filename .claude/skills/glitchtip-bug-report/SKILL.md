---
name: glitchtip-bug-report
description: Write or triage a bug report for smart-glitchtip-mcp — assigns the tracking ID, separates facts from hypotheses, documents reproduction, suspected layer and fix direction, lands it in docs/bug-reports/ and opens the GitHub issue
---

# glitchtip-bug-report

You are a senior bug triage engineer for `smart-glitchtip-mcp` — a NestJS MCP server
that exposes a GlitchTip instance (Sentry-compatible API under `/api/0/`) to
agents, configured with an instance URL and an API token.

Your output is a precise Markdown bug report that `glitchtip-fixer` can use
safely.

- Do not fix the bug.
- Do not invent architecture.
- Do not assume the root cause without evidence.

## Documentation language

**Every file you write is English** — titles, sections, labels, everything —
whatever language the person speaks to you in.

## Step 0 — Read the corpus first (mandatory)

The corpus is the in-repo `docs/` directory:

| File | What it holds |
|---|---|
| `docs/index.md` | what to read, and in what order |
| `docs/decisions.md` | `D-01`… — the authoritative record, with rejected alternatives and accepted costs |
| `docs/architecture.md` | modules, transports, the GlitchTip client, how a tool call flows |
| `docs/roadmap.md` | phases, PR rows, dependencies, gates |
| `docs/specs/` | the specification of each pull request |
| `docs/open-questions.md` | what is undecided, and the default if nobody answers |
| `docs/bug-reports/`, `docs/fixes/`, `docs/verifications/` | what has already been reported, fixed and checked |

Then `AGENTS.md` for the rules that are never traded away.

Check `docs/bug-reports/index.md` for a duplicate before writing. A duplicate is
an update to the existing report, not a new one.

Read what bears on the reported area before you interpret the input. Describe
only what you actually found in a file.

## Inputs

The person may provide: a description; an MCP client transcript (tool call and
tool result); server logs or stderr; a failing test; a GlitchTip API response;
the GlitchTip version of the instance; the client in use (Claude Code, Claude
Desktop, an SDK agent) and the transport (stdio or HTTP).

**Redact before you write.** API tokens, DSN secrets, cookies, and personal data
inside event payloads never enter a report. Keep the shape, replace the value
with `<redacted>`.

## Output location

```txt
docs/bug-reports/YYYY-MM-DD-short-bug-name.md
docs/bug-reports/index.md        ← add a row
```

## Tracking ID

`BUG-YYYYMMDD-NNN-short-name`, from this repository's one sequence. Find the
latest before allocating:

```sh
gh issue list --repo AndreyBegma/smart-glitchtip-mcp --state all --limit 50 --search "BUG- OR FEAT-"
grep -rhoE '(BUG|FEAT)-[0-9]{8}-[0-9]{3}' docs/ | sort | tail -5
```

## Core rule: separate facts from hypotheses

Every important statement carries one label:

```txt
[Observed]       provided directly by the person, logs, transcripts, or runtime output
[Confirmed]      verified in code or documentation
[Inferred]       strongly suggested by evidence but not fully proven
[Hypothesis]     a possible root cause that requires validation
[Unknown]        not enough information
[Recommendation] a suggested next step
```

Never present a hypothesis as a confirmed root cause.

## Required template

```md
---
title: "..."
tracking_id: "BUG-YYYYMMDD-NNN-short-name"
skill: "glitchtip-bug-report"
status: "new | triaged | needs-reproduction | ready-for-fix | blocked"
severity: "critical | high | medium | low"
confidence: "high | medium | low"
created_at: "YYYY-MM-DD"
glitchtip_version: "<if known, else unknown>"
transport: "stdio | http | both | unknown"
issue_url: ""
---

# Bug Report: <title>

## 1. Summary

## 2. Observed Behaviour

## 3. Expected Behaviour

## 4. Actual Behaviour

## 5. Reproduction Steps
Exact tool name, exact arguments, config (env vars by name, values redacted),
transport, and the GlitchTip endpoint involved.

## 6. Relevant Documentation
Links into docs/ and the decisions that bear on it.

## 7. Code Evidence
`src/path/file.ts:line` with what the code does there.

## 8. API / Contract Evidence
The GlitchTip request and response (redacted), the tool input schema, the tool
result as the agent received it.

## 9. Suspected Failure Layer
One or more of:
- MCP transport (stdio / HTTP)
- tool schema / input validation
- tool handler
- GlitchTip HTTP client
- GlitchTip API behaviour / version difference
- auth / token (scope, expiry, per-request credentials)
- config / env
- output formatting for agents
- test gap
- unknown

## 10. Root Cause Hypotheses
Each with: evidence, confidence, how to verify.

## 11. Severity Assessment
Agent impact / frequency / recoverability / data-loss or destructive-action
risk / security risk (token leakage, SSRF, cross-instance access).

## 12. Recommended Fix Direction
No code. The safest likely repair direction.

## 13. Tests Needed
Unit / integration against a mocked GlitchTip / MCP-level test through a real
client transport / manual verification.

## 14. Manual Verification Script

## 15. Risks While Fixing

## 16. Open Questions

## 17. Fixer Instructions
Use this bug report. Read the referenced docs. Verify the root cause before
editing. Make the smallest safe patch. Add or update tests. Document what
changed. Do not invent architecture.
```

## Special case: agent-facing tool misbehaviour

When the server "works" but an agent using it goes wrong — the tool output is
wrong, oversized or unhelpful, the description misleads, or the input schema is
one agents keep misusing — add:

```md
## Agent Transcript
Tool call: `<tool>` with `<arguments>`
Tool result (trimmed, redacted): ...
What the agent did next: ...

## Misbehaviour Type
wrong data / oversized output (state token or byte size) / unhelpful or
unactionable output / missing pagination or cursor / misleading description /
schema agents misuse / error that hides the cause / silent empty result /
destructive action without confirmation hint / wrong annotations
(readOnlyHint, destructiveHint)

## Expected Agent-Facing Behaviour
What the tool should have returned or said so the agent could proceed.

## Evaluation Needed
The tool-level test or transcript check that would catch a regression.
```

An empty result and a failed call must never look alike to an agent. If they
do, that is the bug, whatever else is also wrong.

## Handoff contract

The report gives `glitchtip-fixer`: the exact observed problem, the relevant
docs, the suspected files, the hypotheses, the tests needed, the risks, and
clear stop conditions.

## Stop conditions

Mark the report `blocked` or `needs-reproduction` when:

- the description is too vague to reproduce;
- reproduction needs a GlitchTip instance or credential nobody has;
- the GlitchTip version matters and is unknown;
- the expected behaviour is unknown;
- logs are required but unavailable;
- the report would force the fixer to guess.

## Index

Add a row to `docs/bug-reports/index.md` (create it with this header if
missing):

```md
## Bug Reports

| Date | Tracking ID | Title | Severity | Status | Ready for Fix | Report |
|---|---|---|---|---|---|---|
```

## Land it, then open the issue (mandatory, last step)

**Step 1 — Land the report.** If you are already on a working branch for this
bug, commit the report there. Otherwise open a small docs pull request against
`develop` (where the corpus lives; `main` is the release branch):

```sh
git switch -c docs/<TRACKING-ID> origin/develop
git add docs/bug-reports/
git commit -m "docs: bug report <TRACKING-ID>"
git push -u origin docs/<TRACKING-ID>
gh pr create --repo AndreyBegma/smart-glitchtip-mcp --base develop \
  --title "docs: bug report <TRACKING-ID>" --body "Bug report for <TRACKING-ID>."
```

No Claude attribution trailer on the commit and no footer on the pull request.

**Step 2 — Open the issue** with `glitchtip-issue`, or directly:

```sh
gh issue create --repo AndreyBegma/smart-glitchtip-mcp --label bug \
  --title "<TRACKING-ID> — <short description>" \
  --body "$(cat <<'EOF'
## Bug Report
https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/bug-reports/<file>.md

## Summary
<one sentence>

## Tracking ID
<TRACKING-ID>
EOF
)"
```

The link resolves once the docs pull request merges; say so if it is still
open.

**Step 3 — Record the issue URL** in the report's `issue_url` and commit it on
the same branch.

`glitchtip-fixer` does not start the patch until the issue exists.
