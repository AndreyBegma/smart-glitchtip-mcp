# `scripts/orchestrator/` — the fleet launcher

The code every smart-glitchtip-mcp worker starts through. Up to three agents work
this repository at once, each in its own worktree under
`~/dev/.wt-smart-glitchtip-mcp-<slot>` and tmux session `gm-<slot>`, dispatched by
an orchestrator session (`.claude/skills/orchestrator`).

Worktrees are cut from `origin/develop` — the integration branch, and
`dispatch.sh`'s default base. `main` is the release branch: it moves only by a
person's `develop` → `main` release pull request and a `v*` tag, and is never a
worker's base.

| File | |
|---|---|
| `dispatch.sh` | launches one worker: worktree, pre-flight, tmux session, brief |
| `watch.sh` | polls the panes and classifies them — `PROMPT`, `IDLE`, `QUOTA-HIT` |
| `claude_config.py` | the one place Claude Code's config paths **and trust keys** are resolved |
| `pretrust_worktree.py` | records folder trust before the session that would be asked for it |
| `accept_dangerous_mode.py` | records the bypass-permissions acceptance, per worktree |
| `fence.py` | the `PreToolUse` ownership fence — refuses a write outside a brief's `owns:` |

Tests: `dispatch_test.sh`, `watch_test.sh`, `fence_test.py`. None is wired into
CI yet; run all three by hand after any change here:

```sh
python3 scripts/orchestrator/fence_test.py
bash scripts/orchestrator/dispatch_test.sh
bash scripts/orchestrator/watch_test.sh
```

**If you change anything here, dispatch something and look at the pane.** The
launch dialogs below were each found by a throwaway dispatch, not by reading.
Nothing in this directory is settled by reading alone.

## The launch dialogs, and where each acceptance is written

A dispatched session has nobody to press Down + Enter for it. A dialog it stops
on is invisible from the launcher — `dispatch.sh` exits `0`, the tmux session is
live — which is why each one gets recorded *before* the session starts, and why
`watch.sh` reports the rest as `PROMPT` rather than `IDLE`.

| Dialog | Recorded in | By |
|---|---|---|
| *Do you trust the files in this folder?* | `.claude.json` → `projects.<key>.hasTrustDialogAccepted` | `pretrust_worktree.py` |
| *This folder pre-approves N tool permission* | the same — but under a **second key**, see below | `pretrust_worktree.py` |
| *Bypass Permissions mode…* | `<worktree>/.claude/settings.local.json` → `skipDangerousModePermissionPrompt` | `accept_dangerous_mode.py` |
| *… now uses usage credits* | nowhere — a billing state, not a preference | `watch.sh` reports `PROMPT` |

## The two trust keys

This is the fact that is easiest to get wrong here, because
one key satisfies the check you are looking at and not the one you are not.

Claude Code decides two different things from `projects.<path>
.hasTrustDialogAccepted`, and it reads a **different `<path>` for each**:

| | key it reads | what it decides |
|---|---|---|
| loose (`Jo()`) | the canonical git root, **or** a walk up from the session's cwd bounded by that directory's own git top level | whether the plain trust dialog appears at all, and which cancel label it carries |
| strict (`Ld()`, "persisted trust") | the canonical git root, and nothing else — no walk | whether the project's `permissions.allow` rules apply, and whether the permission-disclosure backstop is owed |

**The canonical git root of a linked worktree is the main checkout**, not the
worktree. Claude Code says so in its own `/cd` copy: *"This directory is part of
the repository at … Trusting it trusts that whole repository, including its
other worktrees and subdirectories."* In this fleet that is
`~/dev/smart-glitchtip-mcp`, shared by every `~/dev/.wt-smart-glitchtip-mcp-<slot>`.

So recording only the worktree's own path passes the loose check and fails the
strict one, and the pane that produces is:

```
 Quick safety check: Is this a project you created or one you trust?
 ⚠ This folder pre-approves 1 tool permission in .claude/settings.json:
   Bash(gh pr merge:*)
 ❯ No, continue without these permissions
   Yes, I trust this folder
```

The tell is the cancel label. *"No, continue without these permissions"* is the
label Claude Code renders **only when trust is accepted** — an untrusted folder
reads *"No, exit"*. A pane showing the first one is not saying "this folder is
untrusted"; it is saying "the strict key is missing". That is why
`hasTrustDialogAccepted: true` looked like it did not work.

`pretrust_worktree.py` writes **both** keys. The worktree key is not redundant:
it is what the loose check's walk reads, it is the only key that exists for a
directory outside any repository, and a `GLITCHTIP_MCP_REPO` other-repository dispatch
has always relied on it. `claude_config.canonical_git_root()` resolves the
second one — via `git rev-parse --path-format=absolute --git-common-dir`, whose
parent is the one path every worktree of a repository canonicalises to.

Claude Code prints the remedy itself, on the same configuration, when it drops
the rules the strict check gated:

```
Ignoring 1 permissions.allow entry from .claude/settings.json: this workspace
has not been trusted. Run Claude Code interactively here once and accept the
trust dialog, or set projects[<path>].hasTrustDialogAccepted: true in <config>
```

### Why `Bash(gh pr merge:*)` stays in `.claude/settings.json`

It is the trigger named in that pane, and removing it is a real way to close the
dialog: with no `permissions.allow` entry the backstop is not offered. It is the
wrong way, and it was considered and rejected on this row.

- It fixes the symptom. The strict key is still missing, so the project's
  permission rules are still silently dropped on any untrusted configuration.
- It comes back the moment anything adds a `permissions.allow` **or a
  `permissions.additionalDirectories`** entry to that file.
- The rule is what keeps the orchestrator's own `gh pr merge` from prompting.
  Removing it buys a per-machine, untracked `.claude/settings.local.json` step
  in the main checkout that, forgotten on a new machine, breaks unattended
  merging — which is the one property the fleet exists for.

Under `--permission-mode bypassPermissions` the rule grants a worker nothing it
does not already have; it is the orchestrator's, not the fleet's. "Never merge"
is enforced by the brief and by `fence.py`, not by a permission rule.

## The config paths, and the asymmetry

Read them from `claude_config.py` and nowhere else:

```
config dir     CLAUDE_CONFIG_DIR ?? ~/.claude
settings.json  <config dir>/settings.json
.claude.json   $CLAUDE_CONFIG_DIR/.claude.json   when set
               ~/.claude.json                    when not   ← not ~/.claude/.claude.json
```

The two do not both live under the config directory. A resolver that joined the
config dir for both writes trust into a file nothing reads, and passes a test
that only checks the `CLAUDE_CONFIG_DIR`-set case.

`dispatch.sh` resolves the directory once and passes it into the tmux session as
`-e CLAUDE_CONFIG_DIR=…`, so a worker's configuration is the person's
configuration and not whichever one the tmux server happened to be started with.

## What is written where, and what is deliberately not

- **Trust** goes in the person's `.claude.json`, because that is the only file
  Claude Code reads it from.
- **The bypass-permissions acceptance** goes in the *worktree*
  (`localSettings`), never in user settings, even though user settings is what
  Claude Code itself writes on acceptance. The key turns a safety confirmation
  off for every session on the machine; a setting that serves one dispatched
  session should die with that session's worktree. `projectSettings`
  (`.claude/settings.json`) is **not** in that gate's layer list, so seeding it
  there does not work however reasonable it looks.
- **Nothing else.** A launcher that changes how a person's other Claude Code
  sessions behave is a launcher nobody can leave running.
