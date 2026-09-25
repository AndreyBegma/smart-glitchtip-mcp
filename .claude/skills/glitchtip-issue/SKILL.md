---
name: glitchtip-issue
description: Open a GitHub issue on smart-glitchtip-mcp from a finding, a bug report, or a roadmap row — with the tracking ID, the labels, and a link to its specification or report in docs/
---

# glitchtip-issue

You turn something that has been noticed into something that is tracked.

**One repository**: `smart-glitchtip-mcp`
(https://github.com/AndreyBegma/smart-glitchtip-mcp). **One corpus**: the in-repo
`docs/` directory, linked on GitHub as
`https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/...`.

## When to use this

- A roadmap row is about to be started and has no issue.
- A review, an exploration or a fix turned up something real that is out of
  scope for the change in hand.
- A bug report exists in `docs/bug-reports/` and needs a tracked home.

## When not to use this

- The work starts right now and finishes in this session. An issue opened and
  closed in ten minutes is noise. Use `glitchtip-feature`.
- The finding is a question, not a defect. Questions go to
  `docs/open-questions.md`, with the default if nobody answers.
- The finding contradicts a decision in `docs/decisions.md`. Then the decision
  is amended with its cost, or the finding is wrong. Either way it is a docs
  change first.

## Inputs

One of:

| Input | Example |
|---|---|
| a roadmap row | `P1-03 — issue tools: list, get, update, bulk resolve` |
| a finding | "`list_issues` returns full event payloads and blows the agent's context" |
| a bug report | the output of `glitchtip-bug-report` |

## What you produce

A GitHub issue on `AndreyBegma/smart-glitchtip-mcp` with:

**Title**: `<TRACKING-ID> — <short imperative>`

**Tracking ID**: `BUG-YYYYMMDD-NNN-short-name` or
`FEAT-YYYYMMDD-NNN-short-name`. This repository has **one sequence**. Before
allocating, find the latest ID in use:

```sh
gh issue list --repo AndreyBegma/smart-glitchtip-mcp --state all --limit 50 --search "BUG- OR FEAT-"
grep -rhoE '(BUG|FEAT)-[0-9]{8}-[0-9]{3}' docs/ | sort | tail -5
```

`NNN` is the next number after the highest one used on that date (start at
`001`). Never reuse an ID; one ID never means two things.

**Labels**: `bug` or `feature`, plus `phase:<N>` when the row sits in a phase of
`docs/roadmap.md`. Create a missing label with `gh label create` rather than
dropping it.

**Body**, in this order and nothing else:

1. **What is wrong, or what is missing.** Plain words, no preamble.
2. **Why it matters.** What breaks for an agent or an operator, or what cannot
   start until this is done.
3. **Where it is.** `src/path/to/file.ts:42` where known. Repository-relative
   paths or GitHub links only — never a path on the local filesystem.
4. **The specification**, as a GitHub link into `docs/` —
   `docs/specs/<ID>-*.md` if one exists, `docs/bug-reports/<file>.md` for a bug,
   otherwise the roadmap row and the decisions it rests on.
5. **Acceptance**, as a checklist, if it is knowable.

```sh
gh issue create \
  --repo AndreyBegma/smart-glitchtip-mcp \
  --title "<TRACKING-ID> — <short imperative>" \
  --label feature --label "phase:<N>" \
  --body "$(cat <<'EOF'
## What is missing
...

## Why it matters
...

## Where
...

## Specification
https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/<ID>-<slug>.md

## Acceptance
- [ ] ...
EOF
)"
```

## The rules you carry

Before writing, read `AGENTS.md` and check the finding against the rules there
that are never traded away. If the issue proposes something that breaks one of
them, say so in the issue rather than opening it quietly. Do not work from a
remembered list — the file is the authority and it changes.

## What happens next

`glitchtip-feature` (for a `FEAT-`) or `glitchtip-fixer` (for a `BUG-`) takes
the issue number as its entry point. The chain is **issue → branch → pull
request**, and the same tracking ID appears in all three; the pull request says
`Closes #<n>`.

## Never

- Open an issue without a tracking ID.
- Put a local filesystem path in the title or the body.
- Open more than one issue for one tracking ID. Search first:
  `gh issue list --repo AndreyBegma/smart-glitchtip-mcp --state all --search "<TRACKING-ID>"`.
- Paste a GlitchTip API token, a DSN secret, or event payload data from a real
  instance into an issue. Redact it; describe its shape.
- Add a Claude attribution footer to the issue body.
