---
title: "Infrastructure: Docker image, dev compose, Woodpecker pipelines, npm + ghcr publishing"
tracking_id: FEAT-20260925-005-infrastructure
skill: glitchtip-spec
status: ready
phase: 1
depends_on: [FEAT-20260925-001-foundation]
created_at: 2026-09-25
---

# FEAT-20260925-005 — Infrastructure

## Summary

Make every PR checked by Woodpecker, make local development run in Docker, and
make a `v*` tag on `main` publish the npm package and the ghcr image (D-09,
D-15, D-16). No product code.

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | multi-stage production image |
| `.dockerignore` | exclude `node_modules`, `dist`, `.git`, `docs`, `.claude`, `scripts/orchestrator`, `.env*` |
| `compose.yaml` | dev: the MCP server with hot reload, pointed at an external GlitchTip |
| `.env.example` | every variable of the foundation's config table, with placeholders, no real values |
| `.woodpecker/checks.yml` | PR and push checks |
| `.woodpecker/release.yml` | tag → npm + ghcr |
| `.woodpecker/e2e.yml` | manual / cron e2e suite |
| `scripts/ci/check-tag-version.sh` | a `v*` tag must equal `package.json` version |
| `docs/deployment.md` | how to run the image (stdio via `docker run -i`, HTTP), the Woodpecker secrets, how to cut a release |

## Docker image — `Dockerfile`

- Stage `deps`: `oven/bun:1.4.0` — `bun install --frozen-lockfile`.
- Stage `build`: `node:24-bookworm-slim` with `node_modules` from `deps` —
  `npm run build`, then `bun install --production --frozen-lockfile` in a
  separate `prod-deps` stage for runtime modules.
- Stage `runtime`: `node:24-bookworm-slim`, non-root `node` user, `WORKDIR /app`,
  `dist/`, production `node_modules`, `package.json`, `LICENSE`.
  `ENV NODE_ENV=production MCP_TRANSPORT=http MCP_HTTP_PORT=8080`,
  `EXPOSE 8080`, `HEALTHCHECK` on `GET /healthz` using `node -e` (no curl in the
  image), `ENTRYPOINT ["node", "dist/main.js"]`.
- stdio use documented as `docker run -i --rm -e MCP_TRANSPORT=stdio -e GLITCHTIP_URL -e GLITCHTIP_TOKEN ghcr.io/andreybegma/smart-glitchtip-mcp`.
- Labels: `org.opencontainers.image.source=https://github.com/AndreyBegma/smart-glitchtip-mcp`,
  `…licenses=Apache-2.0`, `…version` from a build arg.
- Target `dev` (used by compose): `node:24-bookworm-slim` + bun copied from
  `oven/bun:1.4.0` (`COPY --from`), runs `bun run dev`.
- Platform: `linux/amd64` only for now **[Decided by spec author]**; arm64 is an
  open question (needs QEMU/buildx on the agent).

## Dev compose — `compose.yaml`

One service `mcp`: build target `dev`, bind-mount the repository (with an
anonymous volume over `node_modules`), `env_file: .env`, port
`127.0.0.1:8080:8080`, `MCP_TRANSPORT=http`. No GlitchTip service — development
points at an existing instance (D-14). `.env` is git-ignored already.

## Woodpecker

The toolchain split mirrors D-09: bun installs, Node runs.

**`.woodpecker/checks.yml`** — `when`: `pull_request` to `develop` and `main`;
`push` to `develop`.

| Step | Image | Commands |
|---|---|---|
| install | `oven/bun:1.4.0` | `bun install --frozen-lockfile` |
| lint | `node:24-bookworm-slim` | `npm run lint` |
| typecheck | same | `npm run typecheck` |
| api-generated | same | `npm run api:generate && git diff --exit-code src/glitchtip/generated` (image needs git: use `node:24-bookworm` for this step) |
| test | same | `npm run test` |
| build | same | `npm run build` |
| fence | `python:3` | `python3 scripts/orchestrator/fence_test.py` |
| attribution | `alpine/git` | pull requests only: `git fetch --no-tags origin "$CI_COMMIT_TARGET_BRANCH"`, then fail if any commit in `FETCH_HEAD..$CI_COMMIT_SHA` has a message matching `^(Co-Authored-By: Claude\|Claude-Session:)` (AGENTS.md workflow rule). The clone must not be shallow: set `clone: git: settings: depth: 0` in this pipeline |

Steps after `install` depend on it; the rest run in parallel where Woodpecker
allows (`depends_on`).

**`.woodpecker/release.yml`** — `when: event: tag, ref: refs/tags/v*`.

| Step | Image | What |
|---|---|---|
| verify | `node:24-bookworm` (has git) | `scripts/ci/check-tag-version.sh`; then `git fetch --no-tags origin main` and `git merge-base --is-ancestor "$CI_COMMIT_SHA" FETCH_HEAD` — the tagged commit must be on `main`. Pipeline clone depth 0 |
| checks | as in checks.yml | install, lint, typecheck, test, build |
| npm | `node:24-bookworm-slim` | `npm publish --access public` with `NPM_TOKEN` from secret `npm_token` written to `.npmrc` at runtime, never echoed |
| image | `woodpeckerci/plugin-docker-buildx` | push `ghcr.io/andreybegma/smart-glitchtip-mcp:<version>` and `:latest`; secrets `ghcr_username`, `ghcr_token` |

npm provenance (`--provenance`) is GitHub-Actions-only and is not used.

**`.woodpecker/e2e.yml`** — `when: event: [manual, cron], cron: e2e-nightly`.
Step `e2e` runs `npm run test:e2e` with secrets `e2e_glitchtip_url`,
`e2e_glitchtip_token`, `e2e_glitchtip_org` (= `mcp-e2e`). Without them the suite
skips (foundation, `test:e2e`) — the pipeline is green and says it skipped.

## What the orchestrator does around this PR (not the worker)

These need the Woodpecker MCP and credentials, which a worker does not have:

1. Activate `AndreyBegma/smart-glitchtip-mcp` in Woodpecker when this PR opens,
   so its own pipeline runs on it. Before this PR, nothing is activated —
   activating earlier would put a red "no config" check on every PR.
2. Create the cron `e2e-nightly` (03:00 UTC) after merge.
3. Secrets `npm_token`, `ghcr_username`, `ghcr_token`, `e2e_glitchtip_*` are
   **credentials — the owner's** (orchestrator rule: `BLOCKED — person`). The PR
   merges without them; release and e2e wait for them.

## Acceptance criteria

1. `docker build -t smart-glitchtip-mcp .` succeeds locally; the image runs as a non-root user; `docker run --rm -e GLITCHTIP_URL=https://example.invalid -e MCP_AUTH_TOKEN=x -p 8080:8080 …` answers `GET /healthz` 200.
2. `docker run -i --rm -e MCP_TRANSPORT=stdio -e GLITCHTIP_URL=… ` answers an MCP `initialize` on stdin (scripted check in `docs/deployment.md`, run by the worker and its output pasted in the PR).
3. `docker compose up` starts the dev server with reload on a `src/` change.
4. Image size stated in the PR (measured, D-standard "faster/smaller means measured").
5. `.woodpecker/checks.yml` passes `woodpecker-cli lint` (run via `docker run woodpeckerci/woodpecker-cli lint`), and runs green on this PR once activated.
6. `check-tag-version.sh` has a test: matching tag passes, mismatching fails.
7. No secret value appears in any file; `.env.example` holds placeholders only.
8. `docs/deployment.md` documents: image usage (stdio and HTTP), every env var (link to README table), the Woodpecker secrets by name, and the release procedure (PR `develop`→`main`, then `git tag vX.Y.Z` on `main`).

## Risks

- **`oven/bun:1.4.0` tag** and the lockfile format must match the bun that
  wrote `bun.lock`; a mismatch fails `--frozen-lockfile`. The worker checks the
  local bun version against the tag and states both in the PR.
- The Woodpecker agent's capabilities (docker socket for buildx, network) are
  [Unknown] from the repository; the release pipeline is only exercised on the
  first tag, so the first release is a supervised one.

## Parallel plan

| Slot | Owns | Touches | Depends on | Lead | Model |
|---|---|---|---|---|---|
| p1-infra | infrastructure | `Dockerfile`, `.dockerignore`, `compose.yaml`, `.env.example`, `.woodpecker/**`, `scripts/ci/**`, `docs/deployment.md` | FEAT-20260925-001 merged | no | sonnet |

## Contention

| Resource | Owner | Everyone else |
|---|---|---|
| `.woodpecker/**`, `Dockerfile`, `compose.yaml`, `scripts/ci/**` | p1-infra | do not open |
| `package.json`, `bun.lock` | nobody in phase 1 | p1-infra needs no dependency; a script it wants in `package.json` is a message to the orchestrator |
| `README.md` | nobody in phase 1 | p1-infra links from `docs/deployment.md` only |
