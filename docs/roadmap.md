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
| FEAT-20260925-001 | Scaffold: Nest + mcp-nest, config, GlitchTipClient from the snapshot, InstanceResolver, HTTP auth, toolset registry + read-only, stdio + HTTP, shared formatters, test harness, reference toolset `organizations` | — | [FEAT-20260925-001-foundation](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-001-foundation.md) | token-safety, registration, ssrf | MERGED |

## Phase 1 — Core toolsets and infrastructure (four rows, fleet ceiling three: the fourth dispatches on the first merge)

| ID | Title | Depends on | Spec | Gate | State |
|---|---|---|---|---|---|
| FEAT-20260925-002 | Toolset `issues` (list/search/get/update/bulk/delete, comments, tags, hashes, user reports) | phase 0 | [FEAT-20260925-002-issues-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-002-issues-toolset.md) | registration | MERGED |
| FEAT-20260925-003 | Toolset `events` (issue events, latest, project events, event JSON) | phase 0 | [FEAT-20260925-003-events-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-003-events-toolset.md) | — | MERGED |
| FEAT-20260925-004 | Toolset `projects` (projects, keys/DSN, environments, project teams) | phase 0 | [FEAT-20260925-004-projects-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-004-projects-toolset.md) | registration | MERGED |
| FEAT-20260925-005 | Infrastructure: Dockerfile, compose for dev, Woodpecker pipelines, npm + ghcr publish on tag | phase 0 | [FEAT-20260925-005-infrastructure](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-005-infrastructure.md) | token-safety | MERGED |

## Phase 2 — Remaining toolsets (waves of three; wave 0 first)

Waves come from the adversarial spec review: a wave never has two slots writing one
file. `src/config/**` is written by FEAT-014 in wave 1 and FEAT-015 in wave 3 only.

| ID | Title | Depends on | Spec | Gate | Wave | State |
|---|---|---|---|---|---|---|
| BUG-20260925-006 | Foundation output fixes: valid JSON under budget, fence-aware cut, malformed → agent error, client.raw, path-segment guard, writeEnabled, test harness hardening | FEAT-001..003 | [BUG-20260925-006-foundation-json-budget](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/BUG-20260925-006-foundation-json-budget.md) | token-safety, registration | 0 | MERGED |
| BUG-20260925-016 | Neutralise control/invisible characters in untrusted text; shared flatten; pathSegmentParam C1/bidi | BUG-006 | [BUG-20260925-016-untrusted-control-characters](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/BUG-20260925-016-untrusted-control-characters.md) | token-safety | any | MERGED |
| BUG-20260925-017 | Partial reads overwrite GlitchTip data (projects, releases); token prefix leaks through the 500-char detail cut | BUG-006 | [BUG-20260925-017-partial-read-writes-and-truncated-token](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/BUG-20260925-017-partial-read-writes-and-truncated-token.md) | token-safety | any | MERGED |
| BUG-20260925-018 | Foundation follow-ups: strict timestamps, shared time range, cursor line, alerts extraSecrets, flaky perf test | BUG-017, FEAT-011 | [BUG-20260925-018-foundation-follow-ups](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/BUG-20260925-018-foundation-follow-ups.md) | token-safety | after 011 | BLOCKED — work (FEAT-011) |
| FEAT-20260925-007 | `teams` + `members` | BUG-006 | [FEAT-20260925-007-teams-members-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-007-teams-members-toolset.md) | registration | 1 | MERGED |
| FEAT-20260925-008 | `releases` (deploys, commits, files, repositories) | BUG-006 | [FEAT-20260925-008-releases-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-008-releases-toolset.md) | registration | 1 | MERGED |
| FEAT-20260925-014 | `uploads` (stdio only) | BUG-006 | [FEAT-20260925-014-uploads-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-014-uploads-toolset.md) | registration | 1 | MERGED |
| FEAT-20260925-009 | `alerts` | BUG-006 | [FEAT-20260925-009-alerts-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-009-alerts-toolset.md) | token-safety, registration | 2 | MERGED |
| FEAT-20260925-010 | `monitors` + `status_pages` | BUG-006 | [FEAT-20260925-010-monitors-status-pages-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-010-monitors-status-pages-toolset.md) | registration | 2 | MERGED |
| FEAT-20260925-011 | `performance` + `logs` + `stats` | BUG-006 | [FEAT-20260925-011-performance-logs-stats-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-011-performance-logs-stats-toolset.md) | — | 2 | IN FLIGHT |
| FEAT-20260925-012 | `admin` (users/me, emails read, notifications, license, social apps) | BUG-006 | [FEAT-20260925-012-admin-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-012-admin-toolset.md) | token-safety, registration | 3 | MERGED |
| FEAT-20260925-013 | `billing` + `ingest` (+ instance settings) | BUG-006 | [FEAT-20260925-013-billing-ingest-toolset](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-013-billing-ingest-toolset.md) | registration | 3 | IN FLIGHT |
| FEAT-20260925-015 | `api_request` escape hatch (`api_get` + gated `api_request`) | BUG-006, FEAT-014 (src/config) | [FEAT-20260925-015-api-request-escape-hatch](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-015-api-request-escape-hatch.md) | ssrf, token-safety, registration | 3 | MERGED |

## Phase 3 — Resources and prompts

| ID | Title | Depends on | Spec | Gate | Wave | State |
|---|---|---|---|---|---|---|
| FEAT-20260925-019 | Resource templates `glitchtip://issues/{issue_id}` and `…/events/{event_id|latest}` | BUG-018 (src/toolsets/issues, src/format) | [FEAT-20260925-019-resources](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-019-resources.md) | token-safety, registration | after BUG-018 | BLOCKED — work (BUG-018) |
| FEAT-20260925-020 | Prompts `triage-issue`, `release-health-report` (instruct, never fetch) | — (issues, events, releases merged) | [FEAT-20260925-020-prompts](https://github.com/AndreyBegma/smart-glitchtip-mcp/blob/develop/docs/specs/FEAT-20260925-020-prompts.md) | registration | any | READY |
