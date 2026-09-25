# Deployment

How to run the image, what Woodpecker needs, and how to cut a release.

## Running the image

Every environment variable is documented in [`README.md`](../README.md#configuration).
None of them belongs in the image — pass them at `docker run` / `docker compose up` time.

### stdio (local agents)

```sh
docker run -i --rm \
  -e MCP_TRANSPORT=stdio \
  -e GLITCHTIP_URL=https://glitchtip.example.com \
  -e GLITCHTIP_TOKEN=<api token> \
  ghcr.io/andreybegma/smart-glitchtip-mcp
```

`docker run -i` keeps stdin/stdout attached for the MCP framing; nothing but
protocol messages goes to stdout (AGENTS.md rule 11).

### HTTP (shared deployment)

```sh
docker run --rm \
  -e GLITCHTIP_URL=https://glitchtip.example.com \
  -e GLITCHTIP_TOKEN=<api token> \
  -e MCP_AUTH_TOKEN=<a random 16+ character secret> \
  -p 8080:8080 \
  ghcr.io/andreybegma/smart-glitchtip-mcp
```

`MCP_TRANSPORT` and `MCP_HTTP_PORT` are already set by the image (`http`,
`8080`); override `MCP_HTTP_PORT` and republish the port if you need another
one. `GET /healthz` answers `200` without authentication — this is also what
the image's own `HEALTHCHECK` polls.

### Local development

```sh
cp .env.example .env    # fill in GLITCHTIP_URL / GLITCHTIP_TOKEN
docker compose up
```

Builds the `dev` target (bun instead of the production Node runtime), bind-mounts
the repository, and reloads on a `src/` change. No GlitchTip service is started —
point `.env` at an existing instance (D-14).

## Woodpecker

Three pipelines, all under `.woodpecker/`:

| File | Trigger | What it does |
|---|---|---|
| `checks.yml` | pull request into `develop` or `main`; push to `develop` | install, lint, typecheck, `api:generate` drift check, test, build, the worker fence test, and (pull requests only) a check that no commit carries a Claude attribution trailer |
| `release.yml` | a `v*` tag | verifies the tag matches `package.json` and is on `main`, re-runs the checks, then publishes to npm and pushes the ghcr image with `woodpeckerci/plugin-kaniko` (unprivileged — no Docker socket, no server-side allowlist needed) |
| `e2e.yml` | manual, or the `e2e-nightly` cron | runs `test:e2e` against the real `mcp-e2e` organization; without its three secrets the suite skips itself and the pipeline stays green (D-14) |

### Activation (the repository owner / orchestrator, not this PR)

1. Activate `AndreyBegma/smart-glitchtip-mcp` in Woodpecker once this PR is
   open, so its checks run on it.
2. Create the `e2e-nightly` cron (03:00 UTC) after this PR merges.

No server-side privileged-plugin allowlist is needed: `release.yml` builds
the image with `woodpeckerci/plugin-kaniko`, which needs no Docker socket.

### Secrets

| Secret | Used by | Value |
|---|---|---|
| `npm_token` | `release.yml`, step `npm` | an npm automation token with publish rights on `smart-glitchtip-mcp`; written to `.npmrc` at runtime, never printed |
| `ghcr_username` | `release.yml`, step `image` | a GitHub username or app with `write:packages` on the repository |
| `ghcr_token` | `release.yml`, step `image` | a GitHub token with `write:packages` |
| `e2e_glitchtip_url` | `e2e.yml` | the GlitchTip instance holding the `mcp-e2e` organization |
| `e2e_glitchtip_token` | `e2e.yml` | a token scoped to `mcp-e2e` only |
| `e2e_glitchtip_org` | `e2e.yml` | `mcp-e2e` |

All six are credentials the owner provides directly in Woodpecker's secret
store — never committed, never in `.env.example`. The release and e2e
pipelines run without them and simply cannot complete their last step until
they are set.

## Cutting a release

`main` only ever moves through a release pull request (D-16):

1. Open a pull request `develop` → `main` with the changelog and version bump
   in `package.json`.
2. Once merged, tag the resulting commit on `main`:
   ```sh
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
3. `release.yml` runs: `scripts/ci/check-tag-version.sh` fails the pipeline if
   `X.Y.Z` does not equal `package.json`'s `version`, and a second check fails
   it if the tagged commit is not on `main`. Both must pass before anything
   publishes.
4. On success: `smart-glitchtip-mcp@X.Y.Z` on npm, and
   `ghcr.io/andreybegma/smart-glitchtip-mcp:vX.Y.Z` + `:latest` on ghcr.

This is a person's decision end to end — nothing here bumps a version, edits a
changelog, or pushes a tag on its own.
