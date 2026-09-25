# smart-glitchtip-mcp

An MCP server that gives agents the full working surface of a
[GlitchTip](https://glitchtip.com) instance — issues, events, projects,
releases, alerts, uptime monitors, performance and more. Point it at an instance
URL with an API token.

> Status: foundation in place (transports, auth, the GlitchTip client, the
> `organizations` toolset). Further toolsets land per
> [`docs/roadmap.md`](docs/roadmap.md).

- NestJS + [`@rekog/mcp-nest`](https://github.com/rekog-labs/MCP-Nest)
- stdio and stateless Streamable HTTP
- read-only by default; toolsets switched on per deployment
- targets GlitchTip 6.2.6

## Run

Requires Node.js 24 or later.

### stdio (local agents)

```sh
GLITCHTIP_URL=https://glitchtip.example.com \
GLITCHTIP_TOKEN=<api token> \
npx smart-glitchtip-mcp
```

For example, in an MCP client configuration:

```json
{
  "mcpServers": {
    "glitchtip": {
      "command": "npx",
      "args": ["smart-glitchtip-mcp"],
      "env": {
        "GLITCHTIP_URL": "https://glitchtip.example.com",
        "GLITCHTIP_TOKEN": "<api token>"
      }
    }
  }
}
```

stdout carries only MCP messages; logs go to stderr.

### HTTP (shared deployment)

```sh
MCP_TRANSPORT=http \
MCP_HTTP_PORT=8080 \
GLITCHTIP_URL=https://glitchtip.example.com \
npx smart-glitchtip-mcp
```

The MCP endpoint is `POST /mcp` (stateless Streamable HTTP; no session ids).
`GET /healthz` answers `ok` without authentication. Every MCP request must carry
`Authorization: Bearer <token>`, otherwise it gets `401`:

- **Your own GlitchTip token** as the bearer: the server forwards it to
  GlitchTip, which decides what you may do.
- **`MCP_AUTH_TOKEN`** as the bearer: the server acts with its own
  `GLITCHTIP_TOKEN`. A server holding `GLITCHTIP_TOKEN` refuses to start in HTTP
  mode unless `MCP_AUTH_TOKEN` is set, so the token is never open to anyone who
  can reach the port.

Optional request headers:

| Header | Meaning |
|---|---|
| `X-GlitchTip-Url` | Another GlitchTip instance to act on. Only with your own token, and only when it is `GLITCHTIP_URL` or listed in `GLITCHTIP_ALLOWED_URLS`; anything else is refused. |
| `X-GlitchTip-Org` | Default organization slug for this request. |

## Configuration

All configuration comes from environment variables. Invalid configuration stops
startup with one line per problem on stderr, naming the variable (never its
value), and exit code 1.

| Variable | Type / default | Meaning |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` \| `http`, default `stdio` | transport |
| `MCP_HTTP_PORT` | int, default `8080` | HTTP port |
| `MCP_HTTP_PATH` | default `/mcp` | endpoint path |
| `MCP_AUTH_TOKEN` | string, optional; at least 16 characters, no whitespace | shared secret for HTTP clients that do not bring their own GlitchTip token; required in HTTP mode when `GLITCHTIP_TOKEN` is set |
| `GLITCHTIP_URL` | URL, required in stdio; optional in http | default instance |
| `GLITCHTIP_TOKEN` | string, optional | default token |
| `GLITCHTIP_DEFAULT_ORG` | slug, optional | default organization |
| `GLITCHTIP_ALLOWED_URLS` | comma list of origins, default empty | other instances an HTTP client may select with `X-GlitchTip-Url`; empty means only `GLITCHTIP_URL` |
| `GLITCHTIP_TOOLSETS` | comma list, default `organizations,issues,events,projects`; `all` allowed | enabled toolsets |
| `GLITCHTIP_READ_ONLY` | bool, default `true` | `false` registers the tools that change or delete data |
| `GLITCHTIP_TIMEOUT_MS` | int, default `15000` | timeout of each request to GlitchTip |
| `MCP_RESPONSE_BUDGET` | int chars, default `20000` | maximum size of a tool result; longer results are truncated and say so — `format: "json"` results stay valid JSON, marked `"truncated": true` |
| `LOG_LEVEL` | pino level, default `info` | log level (logs go to stderr; HTTP request lines carry method, path and a short list of harmless headers, never credentials) |

Known toolsets: `organizations`, `issues`, `events`, `projects`, `teams`,
`members`, `releases`, `alerts`, `monitors`, `status_pages`, `performance`,
`logs`, `stats`, `admin`, `billing`, `ingest`, `uploads`, `api_request`. A known
toolset that is not implemented yet is accepted and logged as "not yet
available"; an unknown name stops startup.

Requests to GlitchTip time out after `GLITCHTIP_TIMEOUT_MS`. Reads are retried
up to twice on 429, 5xx and network errors, honouring `Retry-After`; writes are
never retried.

## Tools

`whoami` is always available. Other tools come in toolsets, each documented in
[`docs/tools/`](docs/tools/):

- [`organizations`](docs/tools/organizations.md)

## Development

```sh
bun install
bun run lint
bun run typecheck
bun run test        # unit, contract, protocol, HTTP and process tests; no network
bun run build
bun run test:e2e    # against a real instance; needs E2E_GLITCHTIP_URL, _TOKEN, _ORG
bun run api:generate   # regenerate src/glitchtip/generated from the API snapshot
```

## Contributing

Read [`AGENTS.md`](AGENTS.md) first. Work is tracked as `FEAT-`/`BUG-` IDs and
lands on `develop`; `main` carries releases only.

## License

Apache-2.0
