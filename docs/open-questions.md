# Open questions

| # | Question | Why it matters | Default if unanswered |
|---|---|---|---|
| 1 | Organization `mcp-e2e` and its scoped token on errors.luna-realm.com | e2e suite (`D-14`) cannot run without it | e2e stays manual-skipped until it exists |
| 2 | arm64 Docker image | Apple Silicon / ARM servers; needs QEMU or a native agent in Woodpecker | amd64 only (FEAT-20260925-005) |
| 3 | Woodpecker secrets `npm_token`, `ghcr_username`, `ghcr_token`, `e2e_glitchtip_url/token/org` | release and e2e pipelines cannot run without them | pipelines merge; release and e2e wait |
| 4 | Report upstream: `project.write` typo in `apps/teams/api.py` (add/remove team to project) | only `project:admin` works for those routes | documented in the projects toolset; no upstream report yet |
