# Roadmap

The queue the orchestrator dispatches from. A row without a spec in `specs/`
is `NO SPEC` and is not dispatchable. Tracking IDs are allocated by
`glitchtip-spec` when the spec is written.

## Ordering constraints

- Phase 0 lands before everything: it is the precedent every toolset copies.
- Phase 1 toolsets and the infrastructure row run in parallel once phase 0 has
  merged into `develop`.
- Phase 3 starts after the toolsets it exposes as resources have merged.

## Review gates

| Gate | Applies to | What a reviewer checks |
|---|---|---|
| token-safety | anything touching auth, config, logging, errors | the token cannot reach a log, a tool result or an error message (`AGENTS.md` rule 1) |
| registration | any new toolset or mutating tool | read-only and disabled toolsets are absent from `tools/list`, proven by a protocol test (rule 4) |
| ssrf | InstanceResolver, HTTP transport | a header URL outside the allowlist is refused (rule 9) |

## Phase 0 — Foundation (one slot, Opus)

| ID | Title | Depends on | Spec | Gate | State |
|---|---|---|---|---|---|
| FEAT-20260925-001 | Scaffold: Nest + mcp-nest, config, GlitchTipClient from the snapshot, InstanceResolver, HTTP auth, toolset registry + read-only, stdio + HTTP, shared formatters, test harness, reference toolset `organizations` | — | [FEAT-20260925-001-foundation](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-001-foundation.md) | token-safety, registration, ssrf | READY |

## Phase 1 — Core toolsets and infrastructure (four rows, fleet ceiling three: the fourth dispatches on the first merge)

| ID | Title | Depends on | Spec | Gate | State |
|---|---|---|---|---|---|
| FEAT-20260925-002 | Toolset `issues` (list/search/get/update/bulk/delete, comments, tags, hashes, user reports) | phase 0 | [FEAT-20260925-002-issues-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-002-issues-toolset.md) | registration | BLOCKED — work (phase 0) |
| FEAT-20260925-003 | Toolset `events` (issue events, latest, project events, event JSON) | phase 0 | [FEAT-20260925-003-events-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-003-events-toolset.md) | — | BLOCKED — work (phase 0) |
| FEAT-20260925-004 | Toolset `projects` (projects, keys/DSN, environments, project teams) | phase 0 | [FEAT-20260925-004-projects-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-004-projects-toolset.md) | registration | BLOCKED — work (phase 0) |
| FEAT-20260925-005 | Infrastructure: Dockerfile, compose for dev, Woodpecker pipelines, npm + ghcr publish on tag | phase 0 | [FEAT-20260925-005-infrastructure](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-005-infrastructure.md) | token-safety | BLOCKED — work (phase 0) |

## Phase 2 — Remaining toolsets (waves of three)

| ID | Title | Depends on | Spec | Gate | State |
|---|---|---|---|---|---|
| — | `teams` + `members` | phase 0 | — | registration | NO SPEC |
| — | `releases` (deploys, commits, files) | phase 0 | — | registration | NO SPEC |
| — | `alerts` | phase 0 | — | registration | NO SPEC |
| — | `monitors` + `status_pages` | phase 0 | — | registration | NO SPEC |
| — | `performance` (transaction groups, spans, n+1) + `logs` + `stats` | phase 0 | — | — | NO SPEC |
| — | `admin` (API tokens, users, emails, license, social apps, notifications) | phase 0 | — | token-safety, registration | NO SPEC |
| — | `billing` + `ingest` | phase 0 | — | registration | NO SPEC |
| — | `uploads` (stdio only) | phase 0 | — | registration | NO SPEC |
| — | `api_request` escape hatch | phase 0 | — | ssrf, registration | NO SPEC |

## Phase 3 — Resources and prompts

| ID | Title | Depends on | Spec | Gate | State |
|---|---|---|---|---|---|
| — | Resource templates `glitchtip://issues/{id}`, `glitchtip://events/{id}` | issues, events | — | — | NO SPEC |
| — | Prompts `triage-issue`, `release-health-report` | issues, events, releases | — | — | NO SPEC |
