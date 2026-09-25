# Architecture

The target shape, from `decisions.md`. Phase 0 builds it; later phases add
toolsets into it without changing it.

## Request path

```
agent ──MCP──▶ transport (stdio | Streamable HTTP, stateless)       D-04
                 │
                 ▼
            auth guard (HTTP only)                                  D-05
                 │  pass-through Bearer, or MCP_AUTH_TOKEN + env token
                 ▼
            InstanceResolver ─ URL/token/org for this request       D-03, D-11
                 │  env defaults, header overrides, allowlist check
                 ▼
            toolset controller (@McpController, thin adapter)       D-08
                 │  zod input schema, annotations
                 ▼
            GlitchTipClient ─ generated types from the snapshot     D-02, D-13
                 │  timeout, GET retries, error mapping, Link paging
                 ▼
            GlitchTip /api/0/...
                 │
                 ▼
            <toolset>.format.ts → compact text within budget        D-12
```

## Layout

```
src/
  config/           zod schema for env, parsing, defaults
  glitchtip/        generated OpenAPI types, GlitchTipClient,
                    InstanceResolver, error mapping, pagination
  mcp/              McpStrategy, transports, auth guard,
                    toolset registry, read-only filtering
  toolsets/<name>/  <name>.tools.ts          read tools
                    <name>.mutations.ts      mutating tools (separate
                                             controller, D-07)
                    <name>.format.ts         rendering for the LLM
  format/           shared renderers: tables, stack traces,
                    budget and truncation
```

- Tools call `GlitchTipClient` directly. There is no service layer between a
  controller and the client (`D-08`).
- `AppModule.forRoot(config)` wires only the controllers of enabled toolsets,
  and only read controllers when read-only (`D-06`, `D-07`).
- `organizations` is the reference toolset built in phase 0; every later toolset
  copies its shape.

## Configuration

| Variable | Meaning |
|---|---|
| `GLITCHTIP_URL` | default instance URL |
| `GLITCHTIP_TOKEN` | default instance token |
| `GLITCHTIP_DEFAULT_ORG` | default organization slug |
| `GLITCHTIP_ALLOWED_URLS` | allowlist for header-supplied URLs (empty = env URL only) |
| `GLITCHTIP_TOOLSETS` | enabled toolsets (default `organizations,issues,events,projects`) |
| `GLITCHTIP_READ_ONLY` | `true` by default; `false` registers mutating tools |
| `MCP_TRANSPORT` | `stdio` or `http` |
| `MCP_AUTH_TOKEN` | required for HTTP clients that do not bring their own GlitchTip token |

Header overrides in HTTP mode: `X-GlitchTip-Url`, `Authorization: Bearer`,
`X-GlitchTip-Org`.

## The API snapshot

`docs/reference/glitchtip-openapi.json` is the GlitchTip 6.2.6 schema. The
typed client is generated from it; `bun run api:sync` refreshes it from an
instance and regenerates. Contract tests run against it.

## Tests

| Layer | How | When |
|---|---|---|
| unit | tool handlers and formatters against a mocked HTTP layer | every PR |
| contract | requests checked against the OpenAPI snapshot | every PR |
| protocol | in-memory MCP client: `tools/list`, `tools/call` | every PR |
| e2e | real instance, `mcp-e2e` organization only | manual / nightly |

## Delivery

- Woodpecker: lint, typecheck, test, build on every PR; npm and
  `ghcr.io/andreybegma/smart-glitchtip-mcp` on a `v*` tag on `main` (`D-15`).
- Local development runs in Docker (`docker compose`), MCP server with hot
  reload, pointed at an external GlitchTip.
