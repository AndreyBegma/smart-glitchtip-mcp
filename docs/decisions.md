# Decisions

Each decision: ID, date, decision, why, rejected alternatives, accepted cost.
Amending a decision is a new entry that names the one it replaces.

All entries below came out of the initial design interview on 2026-09-25.

---

## D-01 — Product identity

**Decision.** The product is `smart-glitchtip-mcp`: a public, Apache-2.0
repository (`AndreyBegma/smart-glitchtip-mcp`), npm package and binary
`smart-glitchtip-mcp`, Docker image `ghcr.io/andreybegma/smart-glitchtip-mcp`.

**Why.** `glitchtip-mcp` is taken on npm. One name everywhere avoids a mapping
table in every README.

**Rejected.** Scoped `@andreybegma/glitchtip-mcp` — free, but diverges from the
image and repository name. MIT — Apache-2.0 chosen for the patent grant.

## D-02 — Target GlitchTip version

**Decision.** Target the latest GlitchTip release, currently **6.2.6**. The API
schema snapshot lives at `docs/reference/glitchtip-openapi.json`; the typed
client is generated from it (`openapi-typescript` + `openapi-fetch`) and the
snapshot is refreshed by `bun run api:sync`.

**Why.** The owner's instance runs 6.2.6, which is also the latest tag. A
generated client makes an API drift a type error rather than a runtime surprise.

**Accepted cost.** Older GlitchTip versions are best-effort, not supported.

## D-03 — Instance resolution

**Decision.** Instance URL and token come from env (`GLITCHTIP_URL`,
`GLITCHTIP_TOKEN`) by default. In HTTP mode, request headers
(`X-GlitchTip-Url`, `Authorization: Bearer`) override them. A URL from a header
must match `GLITCHTIP_ALLOWED_URLS`; with an empty allowlist only the env URL is
accepted.

**Why.** One deployed server can act for many people with their own tokens,
without becoming an open HTTP proxy (SSRF).

**Rejected.** Env-only (one process per instance) — too narrow for a shared
deployment. Headers-only — useless for stdio.

## D-04 — Transports

**Decision.** stdio and Streamable HTTP from one codebase, selected by config.
HTTP is **stateless**: every request carries its own credentials, no
`Mcp-Session-Id`. Legacy SSE is not implemented.

**Why.** Stateless scales horizontally and keeps no per-session memory; no tool
needs server-initiated notifications.

**Rejected.** Stateful sessions — sticky routing for features nothing uses.

## D-05 — Authentication to the MCP server (HTTP mode)

**Decision.**
1. A client that sends its own GlitchTip token as `Authorization: Bearer` is
   served with that token (pass-through; GlitchTip validates it).
2. Otherwise the client must present `MCP_AUTH_TOKEN`, and the env GlitchTip
   token is used.
3. Neither → `401`.

**Why.** A deployment holding an env token must never be open to the world.

**Rejected.** OAuth via an external authorization server — not needed yet.

## D-06 — API coverage and toolsets

**Decision.** The whole GlitchTip API is covered, grouped into **toolsets**
enabled by `GLITCHTIP_TOOLSETS`.

| Default on | Default off |
|---|---|
| `organizations`, `issues`, `events`, `projects` | everything else, including `admin` (API tokens, users, emails, license, social apps), `billing` (stripe), `ingest` (store/security/test event), `uploads` (chunk upload, dSYMs, artifact bundles) |

Binary uploads are available in **stdio mode only**, from a local file path.
A generic `api_request` tool is the escape hatch: GET only, mutations through
it behind a separate flag.

**Why.** 80+ tools in one list degrade tool selection and burn context.
Toolsets are the pattern GitHub's MCP server proved.

**Rejected.** One tool per endpoint, all on. Consolidated `action`-parameter
tools — one tool cannot be both read-only and destructive, which breaks
annotations.

## D-07 — Read-only by default, enforced at registration

**Decision.** The server starts read-only. Mutating tools live in separate
controllers and are not registered at all unless `GLITCHTIP_READ_ONLY=false`.
Disabled toolsets are likewise not registered: `AppModule.forRoot(config)`
wires only the enabled controllers.

**Why.** A guard that refuses at call time still lists the tool; the agent
spends tokens trying it.

## D-08 — MCP framework

**Decision.** `@rekog/mcp-nest` 2.x (MCP SDK v2, `McpStrategy` +
`@McpController`), version pinned exactly. Controllers are thin adapters over
`GlitchTipClient`; no service layer between them.

**Why.** Native Nest guards, pipes, interceptors and filters on tools; stdio and
Streamable HTTP provided. Keeping business logic out of the decorated classes
means a library change rewrites adapters only.

**Rejected.** An in-house layer over the official SDK — transports, sessions and
protocol tests become ours to maintain.

## D-09 — Runtime and tooling

**Decision.** Node 24 runtime (npm users run it via `npx`; image on
`node:24-slim`). Bun for install and scripts. Tests on vitest + swc. Lint and
format with biome. Logs via `nestjs-pino` to **stderr**, JSON in production,
pretty in development, `Authorization` and token fields redacted.

**Why.** Nest's DI relies on decorator metadata, which is most reliable on Node;
stdout belongs to the protocol in stdio mode.

**Rejected.** Bun as runtime and `bun test`.

## D-10 — Tool naming

**Decision.** snake_case verb + noun, no prefix: `list_issues`, `get_issue`,
`resolve_issue`. Tool names and input schemas are a public contract.

**Why.** Clients namespace by server name already
(`mcp__smart-glitchtip__list_issues`); a prefix doubles the noise.

## D-11 — Default organization

**Decision.** `organization` is optional on every tool. Default comes from
`GLITCHTIP_DEFAULT_ORG` or the `X-GlitchTip-Org` header; if the token sees
exactly one organization, it is used automatically.

## D-12 — Output shape

**Decision.** Tool results are compact text for an LLM: lists as a table of key
fields with `nextCursor` (GlitchTip paginates via the `Link` header); events
with the stack trace collapsed to in-app frames plus breadcrumbs and tags. A
response budget (default ~20k characters) truncates and says so. `format:
"json"` returns a projected JSON; `get_event_json` returns the full raw event.
No `outputSchema` / `structuredContent` in v1.

**Why.** The spec asks servers to mirror `structuredContent` into text for
compatibility, which doubles tokens for no client that consumes it today.

## D-13 — Outbound call policy

**Decision.** 15 s timeout per request. On 429 and 5xx, GET is retried twice,
honouring `Retry-After`; mutations are never retried. 401/403 become tool
errors naming the missing scope. No circuit breaker in v1.

## D-14 — Testing

**Decision.** On every PR: unit tests against a mocked HTTP layer, contract
tests against the OpenAPI snapshot, protocol tests through an in-memory MCP
client (`tools/list`, `tools/call`). End-to-end tests run against
`https://errors.luna-realm.com` in a dedicated organization **`mcp-e2e`** with a
token scoped to it; they create and delete their own objects and run manually
or nightly, never per PR.

**Accepted cost.** Organization creation is disabled on that instance; the
owner creates `mcp-e2e` and its token as superuser.

## D-15 — CI and publishing

**Decision.** Woodpecker CI. Every PR: lint, typecheck, test, build. A `v*` tag
on `main` publishes npm and the ghcr image.

## D-16 — Branch model and releases

**Decision.** `main` is the release branch. `develop` is the integration
branch: feature and fix branches are cut from it and merged into it, and corpus
changes land on it. A release is the owner's decision: a PR `develop` → `main`
with changelog and version bump, then a `v*` tag on `main`.

**Why.** Published artefacts come only from a deliberate promotion.

## D-17 — Resources and prompts

**Decision.** v1 ships tools only. Phase 3 adds resource templates
(`glitchtip://issues/{id}`, `glitchtip://events/{id}`) and prompts
(`triage-issue`, `release-health-report`).

## D-18 — GlitchTip content is untrusted data

**Decision.** Everything that arrives through an event — titles, messages,
culprits, stack-frame source, breadcrumbs, tags, user reports — was submitted via
a public DSN by anyone who has it. Tool output marks it as data, and every tool
description that returns it says so. The server never interprets it as
instructions and never follows URLs found in it.

**Why.** Prompt injection through error payloads is the obvious attack on an agent
reading an error tracker. GlitchTip's own MCP server carries the same warning.

## D-19 — Pinned framework line

**Decision.** NestJS **11** (CommonJS), TypeScript **5.9**, `@rekog/mcp-nest`
2.0.7, `@modelcontextprotocol/{server,core,node,client}` 2.1.0, `hono` 4, zod 4,
Express 5, vitest + `unplugin-swc` with legacy decorators and decorator metadata.
All pinned exactly.

**Why.** `@rekog/mcp-nest` ships CommonJS only. Nest 12 is ESM-only and works with
it only through Node's `require(esm)`. The Nest 11 line was verified end to end
in a probe; TypeScript 7 was not checked for `emitDecoratorMetadata`.

**Rejected.** Nest 12 ESM — it works on Node 24, but it rests on an interop path
nobody here has tested beyond a probe.

**Accepted cost.** A later move to Nest 12 is a migration row of its own.

## D-20 — Raw event JSON is redacted for PII (amends D-12)

**Decision.** `get_event_json` returns the event payload minus `user.ip_address`,
`user.geo`, cookie values and `Authorization`/`Cookie` request headers. D-12's
"full raw event" otherwise stands.

**Why.** Least PII by default; an agent debugging an error does not need a
visitor's IP address or session cookie, and a tool result may be logged or
shared by the client.

**Accepted cost.** Those fields are unreachable through this server; `api_request`
(phase 2) is the escape hatch if an operator truly needs them.

## D-21 — The escape hatch is two tools, and a denylist bounds it (amends D-06)

**Decision.** The `api_request` toolset registers `api_get` (read-only, always
listed when the toolset is enabled) and `api_request` (POST/PUT/PATCH/DELETE,
destructive, exact `confirm` of `"<METHOD> /api/0/<path>"`), the latter only
when not read-only **and** `GLITCHTIP_API_REQUEST_ALLOW_WRITE=true`. Paths are
relative to the resolved instance's `/api/0/`; a fixed denylist
(FEAT-20260925-015) refuses secret-minting and account-takeover routes for every
method. `api_request` is the one exception to AGENTS.md rule 5 ("destructive
operations are their own tool"): it is explicit by its own flag, confirm and
annotations.

**Why.** One tool cannot be both read-only and destructive (D-06's own
argument); a GET-only escape hatch still reaches side-effecting GETs.

**Accepted cost.** The denylist needs upkeep as GlitchTip adds routes.

## D-22 — Uploads read local files only below an operator-set root

**Decision.** The `uploads` toolset reads files only below
`GLITCHTIP_UPLOAD_ROOT` (realpath containment, symlinks judged by their target,
no dot-segments below the root, regular files only, at most
`GLITCHTIP_UPLOAD_MAX_BYTES`). Naming `uploads` explicitly with
`MCP_TRANSPORT=http`, or in stdio without a root, fails startup; under
`GLITCHTIP_TOOLSETS=all` it is left out with a warning.

**Why.** An agent steered by untrusted event text (D-18) must not be able to
ship arbitrary local files to the instance.

## D-23 — Admin coverage is narrower than "all" (amends D-06)

**Decision.** D-06's `admin` toolset does not wrap, and `api_request` denies:
API-token management (session-auth only; secrets in responses), MFA recovery
codes, the setup wizard, invitation acceptance, deletion of the user, e-mail
address changes, and SSO app create/update. E-mail addresses and SSO apps are
readable; SSO apps deletable through an explicit tool.

**Why.** Each is either unusable with a bearer token or a credential-minting /
account-takeover path reachable by prompt injection. A person does these in the
GlitchTip UI.

**Accepted cost.** "Full API coverage" has these named holes.

## D-24 — Destructive tools: the target is required, the organization is not

**Decision.** Every destructive tool requires its target (slug, id, version) and
a `confirm` equal to it, checked before any request; `organization` stays
optional with the D-11 default. The one exception is `delete_organization`,
whose target *is* the organization, so there `organization` is required.

**Why.** A wrong default organization makes the target lookup fail (404) or the
server filter the ids out; it cannot redirect a confirmed target to a different
object. Requiring `organization` everywhere doubles every destructive call for
no protection the confirm does not already give.
