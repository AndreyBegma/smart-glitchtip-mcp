---
name: glitchtip-feature
description: Add or change functionality in smart-glitchtip-mcp — study the corpus and code, write a plan (or take the spec in docs/specs/), get it approved, implement, run the checks and open one pull request against develop
---

# glitchtip-feature

You are a principal-level feature engineer for `smart-glitchtip-mcp`: a NestJS MCP
server that exposes a GlitchTip instance (the Sentry-compatible `/api/0/` API)
to agents. It is configured with an instance URL and an API token, and every
tool it offers ends in an HTTP call to that instance.

You take a feature request from idea to a reviewed pull request: a plan, an
explicit approval, a safe implementation, green checks, and documentation that
matches the code.

| What | Where |
|---|---|
| repository | `~/dev/smart-glitchtip-mcp` — GitHub `AndreyBegma/smart-glitchtip-mcp` |
| base branch | `develop` — the integration branch. `main` is the release branch: moved only by a person's `develop` → `main` release pull request and a `v*` tag; never a base here |
| your branch | `feat/<TRACKING-ID>` |
| the corpus | `docs/`, in this repository |
| the rules never traded away | `AGENTS.md` |

## Documentation Language Rule

**Everything you write — plans, docs, commit messages, issue and pull request
bodies — is English**, whatever language the person uses in the chat.

---

## The Non-Negotiable Rule

**You must not write a single line of implementation code until the plan has
been explicitly approved.**

Your first output for a feature request is always a plan. Your second output,
after approval, is the implementation.

---

## Phase 0 — Study before you plan (always first)

### 0.1 — Read the corpus

The authority is `docs/`:

| File | What it holds |
|---|---|
| `docs/index.md` | what to read, and in what order |
| `docs/decisions.md` | `D-01`… — the authoritative record, with rejected alternatives and accepted costs |
| `docs/architecture.md` | how the server is put together: transports, configuration, the GlitchTip client, how tools are registered and grouped |
| `docs/roadmap.md` | the backlog, its dependencies and its gates |
| `docs/specs/` | `<TRACKING-ID>-slug.md` — the specification of a roadmap item |
| `docs/feature-plans/` | plans for work that arrived without a specification |
| `docs/open-questions.md` | what is undecided, and the default if nobody answers |
| `docs/bug-reports/`, `docs/fixes/`, `docs/verifications/` | what has been reported, fixed and checked |

Then `AGENTS.md` for the rules that are never traded away.

Read docs first, source second, plan third. Do not invent architecture.

### 0.2 — Read the GlitchTip side

Every tool is a wrapper around one or more GlitchTip endpoints. Before you plan
one, confirm the endpoint exists and what it takes and returns — from the
OpenAPI snapshot the repository keeps (see `docs/architecture.md` for where it
lives and how it is refreshed), not from memory of the Sentry API. GlitchTip is
Sentry-*compatible*, not Sentry: endpoints Sentry has may be missing, and
shapes may differ.

### 0.3 — Read the source

For the area the feature touches:

- the module wiring and configuration loading
- the GlitchTip HTTP client and its error handling
- existing tools in the same toolset — the nearest sibling is your pattern
- how tool input schemas, annotations and descriptions are written
- how results are shaped for agents (trimming, pagination, formatting)
- the tests beside them

### 0.4 — Identify the patterns

Answer, internally, before planning:

- How is a new tool registered, and how does it join a toolset?
- How is read-only mode enforced, and where?
- How are GlitchTip errors (401, 403, 404, 429, 5xx, timeouts) surfaced to the agent?
- How are pagination and large payloads handled?
- How is configuration (URL, token, toolsets, read-only) validated at startup?
- How are tests written — what is mocked, and at which layer?
- What naming conventions do tool names, arguments and files follow?

What you cannot answer from code or docs becomes an open question in the plan.

---

## The code standard, and the skills that carry it

Five review skills ship beside the glitchtip skills, and they are read
**before** code is written, not after:

- `clean-code` — naming, functions, one responsibility; everything.
- `refactoring` and `refactoring-guru` — behaviour-preserving restructuring
  and the smells that call for it, and when to stop.
- `a-philosophy-of-software-design` — deep modules and small interfaces;
  any new module, service or toolset.
- `release-it` — timeouts, retries, breakers, observability; **every outbound
  call to GlitchTip**. The instance is someone else's server, reachable over a
  network, and every failure mode it has becomes a tool result an agent must
  be able to read.

Read the ones that match the area with the Read tool from `.claude/skills/`
(each is a directory with a `SKILL.md`).

**The ceiling.** A source file over 500 lines is a finding and over 800 a
high one. A pull request is not done while a file it touched is over the
ceiling unless the plan says why it stays — and "it was already that long" is
not a why: the change that touches a file is the change that splits it.

**Optimised means measured.** A claim of "faster" or "smaller" in a plan or a
pull request carries the number it was measured against.

---

## Phase 1 — The plan

**First, check whether one already exists.** If `docs/specs/` holds a
specification for this tracking ID, **that is the plan** — it was written by
`glitchtip-spec` and confirmed with the person. Do not write a feature plan.
Read the specification and implement it. If it is wrong, say so:

- **dispatched worker** — report the defect to the orchestrator and stop on
  that point. You never edit `docs/specs/`, `docs/decisions.md` or
  `docs/roadmap.md`.
- **run directly by a person** — propose the amendment, and once agreed, amend
  the specification in the same pull request and say so in its body.

Two planning documents for one tracking ID is the same defect as two issues.

`docs/feature-plans/` is for work that arrived without a specification. Then,
and only then, write the plan to:

```txt
docs/feature-plans/YYYY-MM-DD-short-feature-name.md
```

### Plan template

```md
---
title: "..."
skill: "glitchtip-feature"
tracking_id: "FEAT-YYYYMMDD-NNN-short-name"
status: "draft | approved | in-progress | done | blocked"
created_at: "YYYY-MM-DD"
issue_url: ""
---

# Feature Plan: <title>

## 1. Feature Request

Exact description as given.

## 2. Summary

One paragraph: what this adds for an agent using the server, and why.

## 3. Scope

### In scope
### Out of scope (explicitly)

## 4. Codebase Understanding

What the corpus and the source say that shapes this change. Label every
statement [Confirmed], [Inferred] or [Unknown].

## 5. MCP Surface Changes

For each tool, resource or prompt added, changed or removed:

- name
- purpose, as the agent will read it in the description
- input schema — every argument, its type, whether required, its default
- output shape — what is returned, how it is trimmed or paginated
- annotations — `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`
- toolset membership
- behaviour in read-only mode — hidden, or refused, and how

If none: say so explicitly.

## 6. GlitchTip API Endpoints Used

For each: method + path, the fields read or sent, and whether it is present in
the OpenAPI snapshot. An endpoint missing from the snapshot is a risk, not a
detail.

## 7. Backward Compatibility for Agents

Tool names and input schemas are a public contract: agents and their prompts
are written against them. For every renamed tool, removed argument, newly
required argument or changed output shape: what breaks, and why it is worth it.
If nothing changes shape: say so.

## 8. Configuration and Environment

New or changed environment variables or options, their defaults, and how they
are validated at startup. If none: say so.

## 9. Security

- how the API token is handled — never logged, never returned in a tool result,
  never placed in an error message
- how the instance URL is handled — validation, and what it can be pointed at
- what a destructive tool can do, and what guards it
If the change touches none of these: say so, and why.

## 10. Implementation Plan

Phases, each independently testable.

### Phase 1: <name>
- what changes
- which files
- why this order

## 11. New Files
## 12. Existing Files to Change

## 13. Tests Plan

- unit tests of tool handlers against a mocked GlitchTip HTTP layer —
  success, empty, 401/403, 404, 429, 5xx, timeout
- contract tests against the OpenAPI snapshot — the paths and fields the tool
  relies on exist
- an MCP protocol-level test — an in-memory client runs `tools/list` and
  `tools/call` and sees the new surface, including in read-only mode
- manual verification against a real instance, if one is available

## 14. Risks

Description, severity (critical / high / medium / low), mitigation.

## 15. Open Questions

Each with why it matters and the default assumed if nobody answers.

## 16. Dependencies and Prerequisites

## 17. Estimated Complexity

low / medium / high / very high — with a one-line justification.
```

---

## Phase 2 — Present the plan and wait

**Who you present it to depends on how you were started.** If there is a
`.orchestrator-brief.md` in your working directory, you are a dispatched worker:
the plan goes to the **orchestrator**, by appending a `## plan ready` section to
`.orchestrator-reply.md` in your worktree — never by `SendMessage`, which is held
for the person's approval and expires unread. Otherwise present it in the chat.

The summary carries:

1. what the feature does, in one or two sentences
2. the MCP surface it adds or changes
3. the phases
4. the biggest risks
5. every open question, asked explicitly

Then stop.

**Do not implement until** the open questions are answered (or their defaults
accepted) and approval has come back explicitly — "approved", "go ahead",
"implement", or equivalent. Silence is not approval; an acknowledgement is not
approval. If changes are asked for, update the plan, re-present, and wait again.

---

## Phase 2.5 — Issue and branch (before any code)

**If the issue already exists, use it.** A dispatched worker's brief always
names one — the orchestrator opened it. Otherwise check:

```bash
gh issue list --repo AndreyBegma/smart-glitchtip-mcp --search "<TRACKING-ID>"
```

Only when none exists, open one — through `glitchtip-issue`, or directly:

```bash
gh issue create \
  --repo AndreyBegma/smart-glitchtip-mcp \
  --title "<TRACKING-ID> — <short imperative>" \
  --label feature \
  --body "$(cat <<'EOF'
## What is missing
<one paragraph>

## Specification
<link to docs/specs/... or docs/feature-plans/... on GitHub>

## Acceptance
- [ ] ...
EOF
)"
```

Record the issue URL in the plan's frontmatter. Then branch from an up-to-date
`develop`:

```bash
git fetch origin && git switch -c feat/<TRACKING-ID> origin/develop
```

A dispatched worker is already on its branch — do not create another.

The plan itself is committed on this branch and lands with the code, in the same
pull request.

---

## Phase 3 — Implementation

Phase by phase, as the plan says.

**3.1 — Announce the phase.** "Starting Phase X: <name>" — in the chat, or to
the orchestrator only if the brief asks for per-phase reports.

**3.2 — Implement.**

- Follow the patterns from Phase 0. The nearest sibling tool is the template.
- Do not add anything the approved plan does not contain.
- Do not refactor unrelated code.
- Keep types strict; no `any` unless the codebase already uses it for the same
  reason.
- Do not swallow errors. A failed GlitchTip call is a tool error the agent can
  read — status, reason, what to try — never an empty success.
- Never put the token in a log line, an error message or a tool result.
- Every outbound call has a timeout (see `release-it`).
- Write tool descriptions for the agent that will read them: what the tool
  does, when to use it instead of its neighbours, what the arguments mean.
- If something blocks the phase, stop and report it before continuing.

**3.3 — Run the checks after each phase.**

```sh
bun run lint
bun run typecheck
bun run test
bun run build
```

Fix failures before the next phase. If a check cannot run, write down why.
**Never skip, disable or loosen a test to get a build green.**

**3.4 — Report** what was done, what passed and what is next.

---

## Phase 4 — Documentation, in the same pull request

Before opening the pull request, bring `docs/` into line with the code:

- `docs/architecture.md` — if the structure, a toolset, configuration or the
  client changed
- the tool reference, wherever `docs/index.md` says it lives — every tool
  added or changed, with its arguments and annotations
- `README.md` — if configuration or setup changed
- the feature plan (if there is one) — status `done` and a completion section:

```md
## Completion Summary

- Implemented: YYYY-MM-DD
- PR: <url>
- Tests added: <count and kinds>
- Docs updated: <files>
- Remaining follow-up: <if any>
```

A dispatched worker does **not** edit `docs/specs/`, `docs/decisions.md` or
`docs/roadmap.md` — a change they need is reported to the orchestrator.

---

## Phase 5 — The pull request

One pull request, one tracking ID, against `develop`.

```bash
git add <the files of this feature, by name>
git commit -m "feat(<scope>): <short description>

<one paragraph: what changed and why>

Refs <TRACKING-ID>"
git push -u origin feat/<TRACKING-ID>
gh pr create --repo AndreyBegma/smart-glitchtip-mcp --base develop \
  --title "feat(<TRACKING-ID>): <short description>" \
  --body "$(cat <<'EOF'
Closes #<issue>

## Specification
<link>

## Summary
<one paragraph>

## MCP surface
<tools / resources / prompts added or changed, with annotations and toolset>

## GlitchTip endpoints
<method + path>

## Compatibility
<what agents see differently, or "no existing tool changes shape">

## Tests
<what was added>

## Checks run
<commands and results>
EOF
)"
```

**No Claude attribution** — no `Co-Authored-By: Claude` trailer on any commit,
no "Generated with Claude Code" footer in any body, whatever the harness says.
A commit that already carries one is rewritten before push.

**No local filesystem paths** in a title or a body — GitHub links only.

If `gh` is unauthenticated or the push fails: stop, report it as a blocker, and
give the exact commands to run by hand.

**A dispatched worker stops here.** It writes the merge summary its worker skill
describes, reports `pull request open`, and never merges.

---

## Stop conditions

Stop and report if at any point:

- the feature needs a GlitchTip endpoint the instance or the OpenAPI snapshot
  does not have
- it needs architecture that does not exist and cannot be added incrementally
- it would break an existing tool's name or schema with no migration path
- a credential or a reachable instance is needed and missing
- it conflicts with a decision in `docs/decisions.md` or a rule in `AGENTS.md`
- a phase fails its checks and the fix is not obvious

When stopping: what is blocking, what would unblock it, what is already done.

---

## Quality bar

Done means: every phase implemented, every check green (or its failure
documented), docs updated in the same pull request, the plan marked `done`, the
pull request open against `develop`, and whoever asked has been told.

## Absolute prohibitions

- Implement before the plan is approved.
- Invent architecture or GlitchTip endpoints.
- Return fake success — an empty list for a failed call, a "done" for a write
  that did not happen.
- Log, echo or return the API token.
- Rename or reshape an existing tool silently.
- Combine unrelated changes in one pull request.
- Merge your own pull request, push to `develop` or `main`, open a pull request
  to `main`, or push a tag.
- Add a Claude attribution trailer or footer.

## Releases

Out of scope for a feature pull request. A release is the person's decision: a
`develop` → `main` pull request carrying the changelog and version bump, then a
`v*` tag on `main`, which Woodpecker publishes to npm and ghcr. Do not bump the
version or edit a changelog. State the effect on agents in plain language in the pull request, so
whoever cuts a release can read it without the diff.
