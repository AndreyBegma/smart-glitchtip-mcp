# Open questions

| # | Question | Why it matters | Default if unanswered |
|---|---|---|---|
| 1 | Organization `mcp-e2e` and its scoped token on errors.luna-realm.com | e2e suite (`D-14`) cannot run without it | e2e stays manual-skipped until it exists |
| 2 | arm64 Docker image | Apple Silicon / ARM servers; needs QEMU or a native agent in Woodpecker | amd64 only (FEAT-20260925-005) |
| 3 | Woodpecker secrets `npm_token`, `ghcr_username`, `ghcr_token`, `e2e_glitchtip_url/token/org` | release and e2e pipelines cannot run without them | pipelines merge; release and e2e wait |
| 4 | Report upstream: `project.write` typo in `apps/teams/api.py` (add/remove team to project) | only `project:admin` works for those routes | documented in the projects toolset; no upstream report yet |
| 5 | Upstream GlitchTip reports: no scope checks on uptime and users routes; status-page list ignores the organization; stats_v2 counts one hour per bucket | documented as workarounds in FEAT-010/011; a fix upstream removes them | not reported yet |
| 6 | README configuration table for keys added by FEAT-014 (`GLITCHTIP_UPLOAD_*`) and FEAT-015 (`GLITCHTIP_API_REQUEST_ALLOW_WRITE`) | slots do not edit README | orchestrator adds after waves 1 and 3 |
