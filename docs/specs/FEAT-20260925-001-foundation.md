---
title: "Foundation: server skeleton, GlitchTip client, instance resolution, toolset registry, reference toolset `organizations`"
tracking_id: FEAT-20260925-001-foundation
skill: glitchtip-spec
status: ready
phase: 0
depends_on: []
created_at: 2026-09-25
---

# FEAT-20260925-001 — Foundation

## Summary

Build the whole request path of `docs/architecture.md` once, with one real
toolset through it, so every later toolset is a copy of a working precedent.
After this PR the server runs over stdio and stateless Streamable HTTP, resolves
the GlitchTip instance per request, authenticates HTTP clients, registers only
enabled toolsets (and only read tools when read-only), calls GlitchTip through
one typed client with timeouts, retries and error mapping, and renders compact
output for agents. The reference toolset is `organizations`, plus `whoami`.

Decisions this implements: D-02 … D-14, D-18, D-19. Nothing here is new design;
where a detail was not settled in the interview it is marked
**[Decided by spec author]** and can be challenged in review.

Reference material the implementer must read first:

- `docs/reference/mcp-nest-2.0.7-notes.md` — verified API facts and gotchas for
  `@rekog/mcp-nest` 2.0.7 (probed end to end). **It overrides the package README**,
  which is stale.
- `docs/reference/glitchtip-endpoints.md` — endpoint details, pagination and
  search facts from the GlitchTip source.
- `docs/reference/glitchtip-openapi.json` — the schema snapshot.

## Dependencies (exact pins, D-19)

All versions exact (no `^`/`~`), as verified together in the probe (notes §9)
or current on 2026-09-25:

Runtime: `@nestjs/common`, `@nestjs/core`, `@nestjs/microservices`,
`@nestjs/platform-express` 11.2.6 · `@rekog/mcp-nest` 2.0.7 ·
`@modelcontextprotocol/server`, `@modelcontextprotocol/core`,
`@modelcontextprotocol/node` 2.1.0 · `hono` 4.13.9 (peer of `/node`) ·
`express` 5.2.1 · `zod` 4.6.5 · `rxjs` 7.8.2 · `reflect-metadata` 0.2.2 ·
`openapi-fetch` 0.17.0 · `nestjs-pino` 5.2.1 · `pino` 10.3.1 · `pino-http` 11.0.0.

Dev: `typescript` 5.9 (latest 5.9.x, pinned) · `@nestjs/testing` 11.2.6 ·
`@modelcontextprotocol/client` 2.1.0 · `vitest` 5.0.2 · `unplugin-swc` 2.0.0 ·
`@swc/core` 1.16.2 · `openapi-typescript` 7.13.0 · `@biomejs/biome` 2.5.14 ·
`@types/node` 24.13.6 · `pino-pretty` 13.1.3 · `undici` 8.11.2 (for
`MockAgent` — Node's bundled undici does not expose it).

If a pin fails to install or resolve together, the worker picks the nearest
working version and states the change in the PR; it does not loosen ranges.

`package.json`: `"name": "smart-glitchtip-mcp"`, `"bin": {"smart-glitchtip-mcp":
"dist/main.js"}` with a `#!/usr/bin/env node` shebang, `"engines": {"node": ">=24"}`,
`"license": "Apache-2.0"`, `"files": ["dist", "LICENSE", "README.md"]`. CommonJS
build (`tsc`, `module: node16`/`commonjs`, `emitDecoratorMetadata`,
`experimentalDecorators`). `.swcrc` with `legacyDecorator` and `decoratorMetadata`
for vitest.

Scripts: `build`, `start` (node dist/main.js), `dev` — no extra dependency:
`tsc -p tsconfig.build.json && (tsc -p tsconfig.build.json -w --preserveWatchOutput & node --watch dist/main.js)`
(used by the infra row's dev container), `lint` (biome
check), `format`, `typecheck` (tsc --noEmit), `test` (vitest run --project unit),
`test:e2e` (vitest run --project e2e),
`api:generate` (openapi-typescript from the snapshot to
`src/glitchtip/generated/schema.d.ts`), `api:sync` (fetch
`<GLITCHTIP_URL>/api/openapi.json`, pretty-print into the snapshot, then
`api:generate`).

The generated file is committed, and `api:generate` must produce no diff in CI
(checked by a script step in the infra row) **[Decided by spec author]**.

**Vitest layout.** `vitest.config.ts` defines two projects:
- `unit` — `src/**/*.spec.ts` and `test/**/*.spec.ts` excluding `test/e2e/**`;
  a `globalSetup` compiles the app with `tsc -p tsconfig.build.json --outDir
  <tmp>` once and exposes the path, so tests that spawn the server (stdio,
  startup-exit) never depend on `dist/` or on the order of CI steps.
- `e2e` — `test/e2e/**/*.spec.ts`, `passWithNoTests: true`; each suite skips
  unless `E2E_GLITCHTIP_URL`, `E2E_GLITCHTIP_TOKEN` and `E2E_GLITCHTIP_ORG` are
  all set. f0 adds one e2e smoke test (`whoami` + `list_organizations` against
  the e2e org) so the project is not empty.

## Layout

```
src/
  main.ts                      bootstrap: parse config, pick transport
  app.module.ts                AppModule.forRoot(config, strategy, httpTransport?)
  config/
    config.schema.ts           zod schema for env (table below)
    config.ts                  parse process.env → AppConfig; fail fast with a
                               message naming the variable, never its value
  glitchtip/
    generated/schema.d.ts      openapi-typescript output (generated)
    glitchtip.client.ts        GlitchTipClient
    glitchtip.errors.ts        GlitchTipError + mapping to agent messages
    pagination.ts              Link header parsing → { nextCursor, hasMore }
    instance.resolver.ts       InstanceResolver
    instance.context.ts        ResolvedInstance type (url, token, org?)
  mcp/
    transports.ts              build stdio / HTTP transports from config
    http-auth.guard.ts         HTTP guard (D-05)
    mcp-http.controller.ts     BYO controller: McpHttpControllerFor(transport)
    tool-error.filter.ts       per-controller filter (mirrors McpExceptionFilter)
    core.tools.ts              `whoami` — always registered, whatever the toolsets
    toolset.registry.ts        toolset name → { read: [...], write: [...] }
    toolset.decorators.ts      shared @GlitchTipTools() = McpController + filter
  format/
    budget.ts                  response budget + truncation marker
    table.ts                   compact list rendering
    untrusted.ts               wrapper that fences untrusted text (D-18)
    result.ts                  text(...) / json(...) / error(...) → CallToolResult
  toolsets/
    organizations/
      organizations.tools.ts       read tools
      organizations.mutations.ts   mutating tools
      organizations.format.ts
test/
  support/in-memory-transport.ts   InMemoryMcpTransport (notes §9)
  support/mock-glitchtip.ts        HTTP-level mock of GlitchTip — `undici` MockAgent
                                   as the global dispatcher, or a `fetch` injected
                                   into GlitchTipClient [Decided by spec author]
  support/boot.ts                  boot the app in-memory or on port 0
```

Unit tests sit next to the code (`*.spec.ts`); protocol and HTTP tests under
`test/`; e2e under `test/e2e/`.

## Configuration

| Variable | Type / default | Meaning |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` \| `http`, default `stdio` | transport |
| `MCP_HTTP_PORT` | int, default `8080` | HTTP port |
| `MCP_HTTP_PATH` | default `/mcp` | endpoint path |
| `MCP_AUTH_TOKEN` | string, optional | D-05 shared secret |
| `GLITCHTIP_URL` | URL, required in stdio; optional in http | default instance |
| `GLITCHTIP_TOKEN` | string, optional | default token |
| `GLITCHTIP_DEFAULT_ORG` | slug, optional | D-11 |
| `GLITCHTIP_ALLOWED_URLS` | comma list of origins, default empty | D-03 allowlist |
| `GLITCHTIP_TOOLSETS` | comma list, default `organizations,issues,events,projects`; `all` allowed | D-06 |
| `GLITCHTIP_READ_ONLY` | bool, default `true` | D-07 |
| `GLITCHTIP_TIMEOUT_MS` | int, default `15000` | D-13 |
| `MCP_RESPONSE_BUDGET` | int chars, default `20000` | D-12 |
| `LOG_LEVEL` | pino level, default `info` | D-09 |

Rules:
- An unknown toolset name in `GLITCHTIP_TOOLSETS` fails startup, listing the
  valid names **[Decided by spec author]**. A known toolset with no
  implementation yet (phase 1 and 2 rows) is accepted and logged as "not yet
  available", so the default value works from this PR onwards.
- In `http` mode with `GLITCHTIP_TOKEN` set and no `MCP_AUTH_TOKEN`, startup
  fails: that deployment would serve the env token to anyone (D-05, rule 9).
- URLs are normalised to origin + optional path prefix, no trailing slash; the
  allowlist compares normalised values.

## Instance resolution (D-03, D-05, D-11)

`InstanceResolver.resolve(rawRequest | undefined): ResolvedInstance`

| Mode | URL | Token | Org |
|---|---|---|---|
| stdio (`rawRequest` undefined) | env | env | env default |
| http, client sent `Authorization: Bearer <t>` where `<t>` ≠ `MCP_AUTH_TOKEN` | `X-GlitchTip-Url` if allowlisted, else env | `<t>` | `X-GlitchTip-Org` ?? env |
| http, client authenticated with `MCP_AUTH_TOKEN` | env (a `X-GlitchTip-Url` header is refused) | env | `X-GlitchTip-Org` ?? env |

- No URL at all (http pass-through, no `X-GlitchTip-Url`, no env
  `GLITCHTIP_URL`) → tool error "No GlitchTip instance: send X-GlitchTip-Url or
  set GLITCHTIP_URL."
- A header URL not on the allowlist (and not equal to the env URL) → tool error
  "instance URL not allowed", naming the URL but not any token.
- The HTTP guard (`http-auth.guard.ts`) runs on the BYO controller
  (notes §7), before `tools/list`: no `Authorization` → `401` with
  `WWW-Authenticate: Bearer`. A bearer equal to `MCP_AUTH_TOKEN` (constant-time
  compare) marks the request `serverToken`; any other bearer is treated as a
  GlitchTip token (pass-through). If `MCP_AUTH_TOKEN` is unset, pass-through is
  the only mode and `serverToken` is impossible.
- Default org when none is given and none configured: call
  `GET /api/0/organizations/`; exactly one → use it, cache per (url, token hash)
  for 5 minutes in memory (rule 2); otherwise tool error listing the slugs and
  asking for `organization`.

## GlitchTipClient (D-13, rule 13)

One class, built on `openapi-fetch` with the generated `paths` type, created per
`ResolvedInstance` (cheap; no shared mutable state besides the org cache).

- Every request: `AbortSignal.timeout(GLITCHTIP_TIMEOUT_MS)`,
  `Authorization: Bearer`, `Accept: application/json`, a `User-Agent` of
  `smart-glitchtip-mcp/<version>`.
- Retries: GET/HEAD only, on 429, any 5xx and network errors (D-13), at most 2
  retries, delay = `Retry-After` (seconds or HTTP date, capped at 10 s) or
  500 ms × 2^n with jitter. Never on POST/PUT/PATCH/DELETE.
- Paging: `list*` helpers return `{ items, nextCursor }` from the `Link` header
  (`rel="next"; results="true"; cursor="…"`, see the endpoint reference).
- Errors become `GlitchTipError { status, kind, message, detail? }`:

| Condition | kind | Agent-facing message (shape) |
|---|---|---|
| 400/422 | `invalid` | "GlitchTip rejected the request: <detail>" |
| 401 | `unauthenticated` | "The GlitchTip token was rejected (401). Check the token." |
| 403 | `forbidden` | "The token lacks permission for <operation>. It needs one of: <scopes>." (scopes passed by the tool) |
| 404 | `not_found` | "<resource> <id> was not found in <org>." |
| 429 after retries | `rate_limited` | "GlitchTip is rate-limiting; retry after <n>s." |
| 5xx after retries | `upstream` | "GlitchTip returned <status>." |
| timeout | `timeout` | "GlitchTip did not answer within <n> ms." |
| network | `unreachable` | "Could not reach <instance origin>." |

- No message, log line or `detail` ever contains the token or the
  `Authorization` header (rule 1). `detail` is GlitchTip's `detail` field
  truncated to 500 characters.

## Tool plumbing

- `@GlitchTipTools()` = `@McpController()` + `@UseFilters(ToolErrorFilter)`.
  No global filters or guards for RPC (notes §6: a global catch-all hangs the
  HTTP 401).
- Errors reach the agent through the two mechanisms verified in notes §6 and
  nothing else: `ToolErrorFilter` is a copy of `McpExceptionFilter`'s shape
  (returns `throwError(() => ({ status: 'error', message }))`) that maps
  `GlitchTipError` and resolver/config errors to their agent message; anything
  else becomes "Internal error in smart-glitchtip-mcp (<error id>)" with the
  stack logged to stderr. The message never includes the token. Handlers may
  also return `error(...)` directly for validation they do themselves.
  **Input-schema (zod) errors never reach the filter** — mcp-nest answers them
  itself with `isError` "Invalid parameters: …" (notes §4); that is accepted as is.
- Handlers take `(@Payload() args, @Ctx() ctx: McpContext)` and get the instance
  via `InstanceResolver.resolve(ctx.getRawRequest())`.
- Every handler returns an explicit `{ content: [...] }` (notes §4: bare strings
  get JSON-quoted). No `outputSchema` (D-12).
- **One file per toolset, created now.** For every toolset name in D-06
  (`organizations`, `issues`, `events`, `projects`, `teams`, `members`,
  `releases`, `alerts`, `monitors`, `status_pages`, `performance`, `logs`,
  `stats`, `admin`, `billing`, `ingest`, `uploads`, `api_request`), f0 creates
  `src/toolsets/<name>/index.ts` exporting
  `export const toolset: ToolsetDefinition = { name: '<name>', read: [], write: [], available: false }`.
  (The names beyond D-06's defaults come from the roadmap's phase 2 rows.)
  `organizations` is the only one with classes and `available: true`.
  `toolset.registry.ts` imports all of them once and is **never edited again**
  by a toolset slot — each later slot fills only its own `index.ts`. This is
  what lets three toolset slots run in parallel without touching one file.
- `AppModule.forRoot(config)` puts into `controllers` the read classes of
  enabled toolsets, plus write classes when not read-only (notes §8). A toolset
  with `available: false` that is enabled is logged as "not yet available".

## Output (D-12, D-18)

- `format/result.ts`: `text(body)`, `json(value)`, `error(message)`.
- `format/budget.ts`: cut at `MCP_RESPONSE_BUDGET` characters on a line
  boundary and append `… truncated N of M characters. Narrow the query or use
  cursor.`
- `format/table.ts`: a compact aligned table (or `key: value` lines for a single
  object) with a trailing `next cursor: <cursor>` line when `hasMore`.
- `format/untrusted.ts`: `untrusted(label, text)` wraps event-derived text as
  `<untrusted source="glitchtip-event" field="…">…</untrusted>` with inner `<`
  escaped. **[Decided by spec author]**: the organizations toolset returns no
  event-derived text, but the helper and its tests land here so phase 1 uses one
  convention.
- Every tool accepts `format?: "text" | "json"` (default `text`); `json` returns
  the projected fields, not the raw payload.

## Tools — toolset `organizations`

Scopes [Confirmed: `@has_permission` in `apps/organizations_ext/api.py` and
`apps/environments/api.py` at `v6.2.6`]: reads and environments accept
`org:read|org:write|org:admin`; update needs `org:write|org:admin`; delete needs
`org:admin`. `whoami` needs none. `create_organization` has no scope check but is
gated by the instance's organization-creation setting. Each tool's description
states its scope.

| Tool | Endpoint | Annotations | Read-only mode |
|---|---|---|---|
| `whoami` (in `src/mcp/core.tools.ts`, always registered) | `GET /api/0/` | readOnly, idempotent | listed |
| `list_organizations` | `GET /api/0/organizations/` | readOnly, idempotent | listed |
| `get_organization` | `GET /api/0/organizations/{organization_slug}/` | readOnly, idempotent | listed |
| `list_organization_environments` | `GET /api/0/organizations/{organization_slug}/environments/` | readOnly, idempotent | listed |
| `create_organization` | `POST /api/0/organizations/` | not readOnly, not destructive | hidden |
| `update_organization` | `PUT /api/0/organizations/{organization_slug}/` (rename only — `OrganizationInSchema` has `name` only) | not destructive, idempotent | hidden |
| `delete_organization` | `DELETE /api/0/organizations/{organization_slug}/` | destructive | hidden |

`openWorldHint: true` on all (they reach an external system).

Descriptions (as the agent reads them; implementer may tighten wording, not
meaning):

- `whoami` — "Show which GlitchTip instance and user this server is acting as,
  the instance version, and the scopes of the token in use. Call this first when
  a tool fails with a permission error." Output: instance origin, version, user
  email/name, token scopes, default organization.
- `list_organizations` — "List organizations the token can see, with slug,
  name and creation date." Input: `cursor?`, `limit?` (1–100, default 50), `format?`.
- `get_organization` — "Get one organization: slug, name, its projects and
  teams (counts and slugs), and the access scopes you hold in it." Fields from
  `OrganizationDetailSchema` only (`projects[]`, `teams[]`, `access[]`,
  `openMembership`, `isAcceptingEvents`). Input: `organization?` (D-11), `format?`.
- `list_organization_environments` — "List environment names used in an
  organization's events." Input: `organization?`, `visibility?:
  "visible"|"hidden"|"all"` (default `visible`), `limit?`, `cursor?`, `format?`.
- `create_organization` — "Create an organization. Many instances disable this
  for non-superusers; GlitchTip then answers 403." Input: `name`.
- `update_organization` — "Rename an organization." Input: `organization?`,
  `name`.
- `delete_organization` — "Permanently delete an organization and everything in
  it: projects, issues, events, releases. Cannot be undone." Input:
  `organization` (required, no default — a destructive call never relies on a
  default **[Decided by spec author]**), `confirm: literal(organization slug)`.

Destructive tools across the whole project follow the same pattern: no default
for the target and a `confirm` field that must equal the target's slug or id.

## Errors

- Every failure reaches the agent as `isError: true` with one of the messages
  above; an empty list renders as "No organizations visible to this token." —
  text that cannot be mistaken for a failure (rule 7).
- Startup failures (bad config) print one line per problem to stderr and exit
  with code 1.

## Logging (D-09, rule 11)

`nestjs-pino` to **stderr** (fd 2) in both modes; pretty when
`NODE_ENV !== 'production'`. Redact paths: `req.headers.authorization`,
`*.token`, `*.GLITCHTIP_TOKEN`, `*.MCP_AUTH_TOKEN`. In stdio mode Nest's own
logger is replaced by pino so nothing reaches stdout, and the strategy's
`logging` is `false` (notes §3).

## Bootstrap

- `stdio`: `NestFactory.createMicroservice(AppModule.forRoot(cfg), { strategy, logger })`
  with `new StdioTransport()`.
- `http`: build `strategy` and `httpTransport = new StreamableHttpTransport({ statefulMode: false })`
  (no `endpoint` — it is ignored when a controller owns the route, notes §2),
  then `NestFactory.create(AppModule.forRoot(cfg, strategy, httpTransport))`.
  `forRoot` declares, inside itself, `@Controller(cfg.httpPath) @UseGuards(HttpAuthGuard)
  class McpHttpController extends McpHttpControllerFor(httpTransport) {}` —
  the pattern verified in notes §7 — so `MCP_HTTP_PATH` takes effect. Order
  `setHttpAdapter → connectMicroservice → startAllMicroservices → listen`
  (notes §2, §7). `GET /healthz` returns `200 ok` without auth.
- Server `instructions` (sent at initialize): two sentences on what the server
  is, that it is read-only unless configured otherwise, and to call `whoami` on
  permission errors.

## Acceptance criteria

1. `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build` pass; `api:generate` produces no diff.
2. Protocol test (in-memory) with `GLITCHTIP_TOOLSETS=organizations` (pinned in the test, so later toolsets do not break it): `tools/list` returns exactly `whoami` and the three organizations read tools, each with the annotations in the table.
3. Protocol test: with `GLITCHTIP_READ_ONLY=false`, the three mutating tools appear; with `true`, calling `delete_organization` returns `-32602 Unknown tool`.
4. Protocol test: with `GLITCHTIP_TOOLSETS=alerts` (a phase 2 name, not yet implemented) startup succeeds, only `whoami` is listed, and a "not yet available" warning is logged; with `GLITCHTIP_TOOLSETS=bogus` startup fails naming the valid toolsets.
5. HTTP test (port 0): no `Authorization` → 401 with `WWW-Authenticate: Bearer` before `tools/list`; bearer = `MCP_AUTH_TOKEN` → env instance used; any other bearer → forwarded to the mocked GlitchTip unchanged.
6. HTTP test: `X-GlitchTip-Url` outside the allowlist → tool error "instance URL not allowed"; inside → the mock for that origin receives the call; with the server token, a URL header is refused.
7. Startup test: http mode with `GLITCHTIP_TOKEN` and without `MCP_AUTH_TOKEN` exits 1 with a message naming `MCP_AUTH_TOKEN`.
8. Client tests: GET retried on 503 twice then surfaced as `upstream`; `Retry-After: 1` honoured (fake timers); POST on 503 not retried; timeout surfaces as `timeout`; `Link` header parsed into `nextCursor`; 403 message names the scopes passed.
9. Token-safety test: with a token `tok_SECRET_123`, force every error kind and assert neither the tool result text nor captured stderr contains `tok_SECRET_123` or the `Authorization` header value.
10. stdio test: spawn the server compiled by the vitest `globalSetup` with `StdioClientTransport`; `tools/list` works and **stdout contains only JSON-RPC frames** (rule 11).
11. Each tool: a test against a mocked GlitchTip response and a test of its error path (404/403). Default-org resolution: single org auto-selected; several → error listing slugs.
12. `delete_organization` rejects when `confirm` does not equal `organization`.
13. Budget test: a list over budget ends with the truncation line; the cut is on a line boundary.
14. README gains a "Configuration" section mirroring the table above, a "Run" section for stdio and http, and a "Tools" section that links `docs/tools/` — one file per toolset, `docs/tools/organizations.md` written here (tool, description, inputs, annotations, scopes). Later slots add their own `docs/tools/<name>.md` and never edit README.
15. `src/toolsets/<name>/index.ts` exists for every D-06 toolset name; a test asserts the registry covers exactly that list.

## Risks

- `whoami` being always registered means a server with every toolset disabled
  still answers one tool — intended: it is the diagnosis tool.
- **mcp-nest 2.x is young** (2.0.x within weeks). Mitigated by D-08 adapters and
  exact pins; the in-memory test harness catches API drift on upgrade.
- **openapi-typescript output for 189 schemas** may be large; it is generated and
  excluded from the 500-line ceiling (generated code is not hand-written code).
- **Undici MockAgent vs openapi-fetch**: openapi-fetch uses global `fetch`; the
  harness must install the MockAgent as the global dispatcher. If that proves
  brittle, inject a `fetch` into the client instead — the client already takes
  one for testability.

## Parallel plan

One slot. Everything here is the shared abstraction the later slots copy; it
cannot be split without two slots deciding the same contract.

| Slot | Owns | Touches | Depends on | Lead | Model |
|---|---|---|---|---|---|
| f0 | the whole foundation | `package.json`, `bun.lock`, `tsconfig*.json`, `biome.json`, `.swcrc`, `vitest.config.ts`, `src/**`, `test/**`, `README.md`, `docs/tools/**` | — | yes | opus |

## Contention

| Resource | Owner | Everyone else |
|---|---|---|
| `package.json`, `bun.lock` | f0 | no other slot runs in this wave |
| `src/mcp/toolset.registry.ts` | f0, final | nobody edits it after f0; later slots fill `src/toolsets/<name>/index.ts` |
| `README.md` | f0 | later slots write `docs/tools/<name>.md` instead |
| `src/config/config.schema.ts` | f0 | later slots do not add env vars without a spec saying so |
| `docs/**` except `docs/tools/**` | orchestrator | never edited by the slot; f0 writes `docs/tools/organizations.md` only |
