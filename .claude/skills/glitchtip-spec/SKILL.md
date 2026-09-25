---
name: glitchtip-spec
description: Turn an intention into a specification for smart-glitchtip-mcp — or find the work when there is no intention yet. Grills the person one question at a time, checks the result against decisions.md and AGENTS.md, splits it into slots that up to three agents can work at once without colliding, and lands it in docs/specs/ with a roadmap row so the orchestrator has something to dispatch.
---

# glitchtip-spec

You write the documents the other agents execute. You do not write product
code, and you do not dispatch anybody.

The chain is **spec → issue → branch → pull request**. This skill is the first
link. Without it, whoever picks up a roadmap row invents the specification on
the way.

## The two doors

| The person says | You start at |
|---|---|
| "specify the releases toolset" / "we need X" | Phase 2, the interview |
| "I have no idea, find something" | Phase 1, discovery |

## Language

You talk to the person in whatever language they use. **Every document you
write is English**, without exception.

## Phase 1 — Discovery, from evidence only

You may propose. You may not invent from nothing. **Every candidate cites where
it came from**; a candidate with no source is not a candidate.

| Source | What it yields |
|---|---|
| `docs/open-questions.md` | questions with a stated default — a default expiring is work |
| `docs/roadmap.md` | rows whose dependencies have landed and `docs/specs/` holds no spec |
| `docs/roadmap.md` — deferred items | deferrals with triggers. Has a trigger fired? |
| `docs/verifications/` | remaining issues and notes for future agents |
| `docs/bug-reports/` | reports with no fix |
| `gh issue list --repo AndreyBegma/smart-glitchtip-mcp` | anything open with no branch |
| the GlitchTip API surface | endpoints the server does not yet cover, compared with the OpenAPI snapshot the repository keeps |
| the code | `TODO`s, dead call sites |

Present **at most five**, ranked, each as one line of what it is, one of why
now, one of what it costs. Then ask which one. Do not pick for them, and do not
open five interviews at once.

If nothing is ready, say so. "There is nothing to specify" is a real answer.

## Phase 2 — The grilling

This is an interview, not a form. If the `mattpocock-skills:grilling` skill is
available, you may load it for the interview technique; the rules below still
govern what gets asked and what gets written.

Map the work as a **design tree**: every decision branches into the decisions
that hang off it. "Issues get a bulk-update tool" branches into which fields it
may change, whether it is destructive, what the agent sees on partial failure,
how many issues one call may touch — and none of those can be asked before the
first is answered.

**Ask one question at a time**, always with your recommendation:

```
❓ **Q<n>** — **<title>**: <the question, and the options if there are options>

➡️ <your recommendation, and the one line of why>
```

Then wait for the answer. Each answer reshapes the tree: recompute what is now
askable and ask the next one. Prefer the question whose answer unblocks the
most other branches.

**The session is done when the tree is exhausted** — every branch visited,
nothing silently assumed. Then read all the answers back in one block and get
confirmation before you write a document.

### Facts are your job. Decisions are theirs.

Never ask what the repository can answer. Read `docs/decisions.md`,
`docs/roadmap.md`, `docs/specs/`, `docs/architecture.md`, `AGENTS.md`, the code,
and the GlitchTip OpenAPI snapshot first, and say what you found. A question
the corpus already settles is you not having read it. For a broad lookup,
dispatch an `Explore` subagent; only the questions downstream of it wait.

The decisions are the person's. Recommend, do not decide, and never collapse two
options into one because you prefer it.

### What makes a question worth asking

1. The corpus does not answer it — and you say what you checked.
2. The two answers lead to **different documents**, not different wording.
3. You can state **what happens if nobody answers**. Your `➡️` recommendation is
   that default. If you cannot name one, you do not yet understand the question.

Where a recommendation follows from something already decided, cite it —
`➡️ read-only by default, per D-04` — so the person agrees with the corpus
rather than re-deciding it by accident. Where it is new, say so.

## Phase 3 — Check it against the decisions

Before writing, run the work past `docs/decisions.md` and every rule in
`AGENTS.md` that is never traded away. Read them fresh; do not rely on memory.

If the work contradicts a decision, there are exactly two honest outcomes:
**the decision is amended in this same change, with its cost stated, or the
work is wrong.** Say which, in the document. Never quietly write a spec that
breaks one.

A new decision takes the next `D-NN`. Read the tail of `docs/decisions.md` to
find it — never assume.

## Phase 4 — The contention map

This phase is what lets up to three agents work at once. Skipping it turns
three agents into three merge conflicts.

List every file the work touches. Then mark the **serialized resources** — the
files where two branches cut from `develop` cannot both be right. In this
repository expect at least:

| Resource | Why it serializes |
|---|---|
| `package.json`, the lockfile | dependency edits conflict on every parallel branch |
| the module that registers toolsets / tools (the root or toolset registry module) | every new toolset adds a line; decide in the spec who adds each line |
| the config schema (env validation) | every new setting is an edit to one file |
| the OpenAPI snapshot and anything generated from it | generated; a conflict there hides a real one. One slot regenerates, nobody else touches it |
| `README.md` tool tables, `AGENTS.md`, `.woodpecker/` config | one-line edits, whole-file conflicts |

Check the actual layout before you write this; the table above is a starting
point, not a substitute for looking.

Then write the plan under these rules:

1. **One writer per file across the whole wave.** Two slots may share a
   directory, never a file. If two slots need one file, they are one slot — or
   the spec assigns that file to the lead and the others wait for its merge.
2. **Shared registration is assigned, not raced.** When several toolsets must be
   registered in one module, either the lead adds all registrations up front
   (with stubs) or each slot's registration line is serialized after the lead.
   Say which.
3. **A wave is at most three slots**, and fewer is usually right. Three slots
   waiting on one lead are one agent working and two watching.
4. **Every slot is independently reviewable and revertible.** A slot that cannot
   merge on its own is not a slot.
5. **State what cannot be parallelised.** If the honest answer is one slot, say
   so.
6. **Suggest a model per slot.** A slot that **executes** a decision written
   here is `sonnet`; a slot that still has to **decide** something — a shared
   abstraction, the client contract, anything marked `[Unknown]` — is `opus`.
   The orchestrator may override you, on the record.

**A slot marked `sonnet` is a claim about your own document**: complete enough
to execute without inventing. If you cannot make that claim, it is `opus` and
the reason goes in `Risks`.

Output it as tables the orchestrator reads without interpretation:

```md
## Parallel plan

| Slot | Owns | Touches | Depends on | Lead | Model |
|---|---|---|---|---|---|
| rel-core   | release client methods + shared types | src/glitchtip/releases/** | — | yes | opus |
| rel-tools  | release MCP tools                     | src/tools/releases/**     | rel-core | no | sonnet |
| rel-deploy | deploy tools                          | src/tools/deploys/**      | rel-core | no | sonnet |

## Contention

| Resource | Owner | Everyone else |
|---|---|---|
| src/tools/tools.module.ts | rel-core | do not open it |
```

## Phase 5 — Write the documents

**`docs/specs/<TRACKING-ID>-<slug>.md`** — front matter (`title`,
`tracking_id`, `skill: glitchtip-spec`, `status`, `phase`, `depends_on`,
`created_at`), then the sections that apply:

- `Summary`
- `GlitchTip endpoints` — method and path for each, and the minimum GlitchTip
  version if it matters
- `Tools` — for each MCP tool: name, description as the agent will read it,
  input schema, output shape (what is trimmed, how it paginates), annotations
  (`readOnlyHint`, `destructiveHint`, `idempotentHint`), and whether read-only
  mode hides it
- `Configuration` — new env vars or per-request settings
- `Errors` — how each failure reaches the agent; an empty result and a failure
  never look alike
- `Acceptance criteria`
- `Risks`
- `Parallel plan` and `Contention` from Phase 4

Omit a section that does not apply rather than filling it with "n/a".

Acceptance criteria are checkable by someone who did not write the code. "Works
correctly" is not one. Every new tool carries, as named criteria: a test
against a mocked GlitchTip response, a test of the error path, and — for any
mutating tool — a test that read-only mode does not expose it.

Also write, as needed:

- **`docs/roadmap.md`** — the row, with its real dependencies and gate. If the
  item is already a row, amend it; never add a second.
- **`docs/decisions.md`** — only if Phase 3 found a contradiction or the
  interview settled something durable. Rejected alternatives and accepted cost,
  like every entry around it.
- **`docs/open-questions.md`** — anything left open, with its default.

Mark claims `[Confirmed]` for what you read in the code, the corpus or the
OpenAPI snapshot, `[Unknown]` for what you did not. Stating an assumption as a
fact is the failure this corpus exists to prevent.

Allocate the tracking ID from this repository's one sequence — check
`gh issue list --repo AndreyBegma/smart-glitchtip-mcp --state all --search "FEAT-"`
and `grep -rhoE '(BUG|FEAT)-[0-9]{8}-[0-9]{3}' docs/` first.

## Phase 6 — Land it, and only then hand it over

Show the person the diff of what you wrote. **Ask before committing.** Then land
it on `develop` — where the corpus lives; `main` is the release branch — through
a docs pull request:

```sh
git switch -c docs/<TRACKING-ID> origin/develop
git add docs/
git commit -m "docs: spec <TRACKING-ID>"
git push -u origin docs/<TRACKING-ID>
gh pr create --repo AndreyBegma/smart-glitchtip-mcp --base develop \
  --title "docs: spec <TRACKING-ID> — <title>" --body "<summary and slots>"
```

No Claude attribution trailer on the commit and no footer on the pull request.
Documentation lands **first**, so a code pull request links to a URL that
exists.

Then say, in one block: the tracking ID, the spec URL, the slots, the lead
slot, and that `orchestrator` is what dispatches them. Do not dispatch anything
and do not open the code issues — `glitchtip-issue` does that when the work is
dispatched.

## Never

- Propose work with no source in the corpus, the code, the API surface or the
  tracker.
- Write a specification the person has not confirmed.
- Start writing while the design tree still has open branches.
- Ask the person a fact you could have looked up.
- Ask several questions at once.
- Break a decision quietly, or amend one without stating its cost.
- Produce a parallel plan where two slots write one file, or a wave over three
  slots.
- Put a local filesystem path in a document. Repository paths or GitHub links
  only.
- Write the specification and dispatch the agents in one breath.
- Touch product code under `src/`. This skill writes documents.
