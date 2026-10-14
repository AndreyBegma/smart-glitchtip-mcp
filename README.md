# smart-glitchtip-mcp

**Give your AI agents the whole of GlitchTip — triage, releases, alerts, uptime and more — over MCP.**

[![npm](https://img.shields.io/npm/v/smart-glitchtip-mcp)](https://www.npmjs.com/package/smart-glitchtip-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/mkQARkBs4C)

Your agent can read a stack trace in your editor, but the error tracker stays a
browser tab away: it cannot list the issues behind a spike, open the latest
event, check what a release broke or resolve what it fixed.
smart-glitchtip-mcp is a [Model Context Protocol](https://modelcontextprotocol.io)
server that puts a [GlitchTip](https://glitchtip.com) instance's API in front of
any MCP client — Claude Code, Codex, Cursor and others — as typed tools with
compact, token-safe output. It is read-only unless you switch writes on.

**Who it is for:** teams that self-host GlitchTip (or use its hosted service)
and want coding agents to investigate and manage errors without copy-pasting
from the web UI.

## What you get

- **About 130 tools in 18 toolsets** covering the GlitchTip 6.2.6 API:
  `organizations`, `issues`, `events`, `projects`, `teams`, `members`,
  `releases`, `alerts`, `monitors`, `status_pages`, `performance`, `logs`,
  `stats`, `admin`, `billing`, `ingest`, `uploads` and an `api_request` escape
  hatch. Each is documented in [`docs/tools/`](docs/tools/).
- **Read-only by default.** Tools that change or delete data are not even
  registered unless `GLITCHTIP_READ_ONLY=false`; toolsets are switched on per
  deployment with `GLITCHTIP_TOOLSETS`.
- **stdio and stateless Streamable HTTP** — one process per developer, or one
  shared server for a team, where each caller can bring their own GlitchTip
  token.
- **Safe output for agents.** Results are compact text (or JSON) bounded by a
  size budget; the API token is scrubbed from every result, log and error; and
  text that comes from event senders (titles, messages, tags) is fenced as
  untrusted so an agent does not follow instructions hidden in it.
- **Prompts and resources.** `triage-issue` and `release-health-report`
  prompts, and `glitchtip://issues/...` resource templates to attach an issue or
  event to a conversation.
- **Several instances.** Over HTTP a caller can pick another allowlisted
  instance with a header; anything outside the allowlist is refused.

## Quick start

Requirements: Node.js 24 or later. The server is published on npm as
[`smart-glitchtip-mcp`](https://www.npmjs.com/package/smart-glitchtip-mcp), so
`npx` runs it without a clone:

```sh
npx -y smart-glitchtip-mcp
```

Or install it globally with `npm i -g smart-glitchtip-mcp` and run
`smart-glitchtip-mcp`. To build it from source instead, see
[Development](#development).

Create an API token in GlitchTip (**Profile → Auth Tokens**) with the scopes
the toolsets you enable need — each file in [`docs/tools/`](docs/tools/) lists
them.

### stdio (local agents)

Add the server to your MCP client configuration, for example:

```json
{
  "mcpServers": {
    "glitchtip": {
      "command": "npx",
      "args": ["-y", "smart-glitchtip-mcp"],
      "env": {
        "GLITCHTIP_URL": "https://glitchtip.example.com",
        "GLITCHTIP_TOKEN": "<api token>"
      }
    }
  }
}
```

With Claude Code:

```sh
claude mcp add glitchtip \
  -e GLITCHTIP_URL=https://glitchtip.example.com \
  -e GLITCHTIP_TOKEN=<api token> \
  -- npx -y smart-glitchtip-mcp
```

stdout carries only MCP messages; logs go to stderr. Then ask the agent, for
example, "list the unresolved issues in project `web` from the last 24 hours
and triage the top one".

### HTTP (shared deployment)

```sh
MCP_TRANSPORT=http \
MCP_HTTP_PORT=8080 \
GLITCHTIP_URL=https://glitchtip.example.com \
npx -y smart-glitchtip-mcp
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

### Docker

```sh
docker build -t smart-glitchtip-mcp .
docker run --rm -p 8080:8080 \
  -e GLITCHTIP_URL=https://glitchtip.example.com \
  -e GLITCHTIP_TOKEN=<api token> \
  -e MCP_AUTH_TOKEN=<a random 16+ character secret> \
  smart-glitchtip-mcp
```

The image defaults to HTTP on port 8080. stdio, `docker compose` for
development and the release pipeline are described in
[`docs/deployment.md`](docs/deployment.md).

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

## Tools, prompts and resources

`whoami` is always available and shows the instance, user and token scopes in
use. Everything else comes in toolsets, enabled with `GLITCHTIP_TOOLSETS`
(default `organizations,issues,events,projects`, or `all`):

| Toolset | What it covers |
|---|---|
| [`organizations`](docs/tools/organizations.md) | organizations and their environments |
| [`issues`](docs/tools/issues.md) | list, search, status, assignment, merge, bulk updates, comments, tags, hashes, user reports |
| [`events`](docs/tools/events.md) | issue and project events, the latest event, raw event JSON (PII-redacted) |
| [`projects`](docs/tools/projects.md) | projects, client keys (DSN), environments, project teams |
| [`teams`](docs/tools/teams.md), [`members`](docs/tools/members.md) | teams, team membership, organization members and roles |
| [`releases`](docs/tools/releases.md) | releases, deploys, commits, release files, repositories |
| [`alerts`](docs/tools/alerts.md) | project alert rules and recipients |
| [`monitors`](docs/tools/monitors.md), [`status_pages`](docs/tools/status_pages.md) | uptime monitors, checks, status pages |
| [`performance`](docs/tools/performance.md), [`logs`](docs/tools/logs.md), [`stats`](docs/tools/stats.md) | transactions, spans, N+1 patterns, logs, organization stats |
| [`admin`](docs/tools/admin.md), [`billing`](docs/tools/billing.md), [`ingest`](docs/tools/ingest.md) | current user, notification settings, license, usage and plans, test events |
| [`uploads`](docs/tools/uploads.md) | debug files, artifact bundles, ProGuard mappings (stdio only) |
| [`api_request`](docs/tools/api_request.md) | `api_get` and a gated `api_request` for endpoints without a dedicated tool |

Two MCP prompts, `triage-issue` and `release-health-report`, guide an agent
through a read-only task with these tools
([`docs/tools/prompts.md`](docs/tools/prompts.md)); each is listed only when
every toolset it uses is enabled. Two resource templates,
`glitchtip://issues/{issue_id}{?organization}` and
`glitchtip://issues/{issue_id}/events/{event_id}{?organization}` (`event_id` may
be `latest`), attach an issue or an event to a conversation by URI
([`docs/tools/resources.md`](docs/tools/resources.md)).

## How it works

```
agent ──MCP──▶ stdio | Streamable HTTP
                 ▼
            auth guard (HTTP only) → instance resolver (URL, token, org)
                 ▼
            toolset tool: zod input schema, read-only gate
                 ▼
            GlitchTip client (types generated from the API snapshot)
                 ▼
            compact, budgeted, token-scrubbed result
```

It is a NestJS application on [`@rekog/mcp-nest`](https://github.com/rekog-labs/MCP-Nest).
The client is generated from a snapshot of the GlitchTip OpenAPI schema, and a
contract test fails if a snapshot refresh drops an endpoint the tools call. Details are in
[`docs/architecture.md`](docs/architecture.md), and every design choice, with
the alternatives rejected, is in [`docs/decisions.md`](docs/decisions.md).

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

`bun run dev` rebuilds and restarts on change; `docker compose up` does the same
in a container pointed at the instance in `.env` (copy
[`.env.example`](.env.example) first).

## Documentation

[`docs/`](docs/index.md) is the authority on what the server does and why.

| Path | What lives there |
|---|---|
| [`docs/tools/`](docs/tools/) | one file per toolset: tools, inputs, annotations, token scopes |
| [`docs/decisions.md`](docs/decisions.md) | design decisions `D-01`… |
| [`docs/architecture.md`](docs/architecture.md) | the request path and the source layout |
| [`docs/deployment.md`](docs/deployment.md) | Docker, Woodpecker CI, cutting a release |
| [`docs/roadmap.md`](docs/roadmap.md) | the backlog and its state |
| [`docs/specs/`](docs/specs/) | one specification per change |

## Contributing

Read [`AGENTS.md`](AGENTS.md) first. Work is tracked as `FEAT-`/`BUG-` IDs and
lands on `develop`; `main` carries releases only.

## License

[Apache-2.0](LICENSE)
