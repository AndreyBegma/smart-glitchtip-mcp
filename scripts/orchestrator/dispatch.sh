#!/usr/bin/env bash
#
# Launch one smart-glitchtip-mcp worker session: its own git worktree, its own tmux
# session, its own Remote Control channel, its own brief.
#
# Used by the orchestrator skill. The launch command lives here rather than
# in the skill so that there is one place where it can be wrong.
#
#   scripts/orchestrator/dispatch.sh <slot> <branch> <brief-path> [model] [base] [delay]
#
#   slot    short handle, lowercased roadmap id: t3, r1
#   branch  full branch name: feat/FEAT-20260925-001-issues-toolset
#   brief   path to the assignment written by the orchestrator
#   model   opus | sonnet | fable (default: fable)
#
#           The orchestrator classifies every slot and passes the model
#           deliberately. An unclassified slot gets the default, which is the
#           most expensive model — so pass it explicitly and put the reason on
#           the board.
#   base    branch to cut from (default: develop — the integration branch;
#           `main` is the release branch and is never a worker's base)
#   delay   seconds to hold before the agent starts (default: 0). The wait
#           happens inside the detached tmux session, so the orchestrator does
#           not block on it and `tmux kill-session -t gm-<slot>` during the
#           window stops the agent before it has read anything.
#
# GLITCHTIP_MCP_REPO (env, default $HOME/dev/smart-glitchtip-mcp)
#   The repository to cut the worktree from. The worktree is
#   `~/dev/.wt-smart-glitchtip-mcp-<slot>` for the default repository and
#   `~/dev/.wt-<basename>-<slot>` for any other.
#
#   A repository whose `.claude/settings.json` does not itself carry the
#   fence hook gets one seeded into the worktree — untracked, regenerated on
#   every dispatch, pointed at *this* checkout's `fence.py` by absolute path
#   — and the worker skill symlinked in from here too. Nothing is committed
#   into that repository.
#
# CLAUDE_CONFIG_DIR (env, default $HOME/.claude)
#   Which Claude Code configuration this dispatch pre-flights against, and the
#   one the worker runs under — resolved by `claude_config.py`, read and
#   written by `pretrust_worktree.py`, and passed into the tmux session
#   explicitly.
#
#   Only the trust record goes there. The bypass-permissions acceptance is
#   written into the worktree instead (`accept_dangerous_mode.py`), so nothing
#   this launcher does changes how the person's other sessions behave.
#
#   Read it from `claude_config.py` and nowhere else. The fallback is not
#   uniform: `settings.json` is under the config directory, but `.claude.json`
#   is not — with the variable unset those are `~/.claude/settings.json` and
#   `~/.claude.json`, never `~/.claude/.claude.json`.
#
set -euo pipefail

SLOT=${1:?slot required, e.g. t3}
BRANCH=${2:?branch required, e.g. feat/FEAT-20260925-001-issues-toolset}
BRIEF=${3:?brief path required}
MODEL=${4:-fable}
BASE=${5:-develop}
DELAY=${6:-0}

case "$DELAY" in
  ''|*[!0-9]*) echo "dispatch: delay must be whole seconds, got '$DELAY'" >&2; exit 1 ;;
esac

case "$MODEL" in
  opus|sonnet|fable) ;;
  *) echo "dispatch: model must be opus, sonnet or fable, got '$MODEL'" >&2; exit 1 ;;
esac

DEFAULT_REPO="$HOME/dev/smart-glitchtip-mcp"
REPO="${GLITCHTIP_MCP_REPO:-$DEFAULT_REPO}"
WT_PREFIX="$(basename "$REPO")"
WT="$HOME/dev/.wt-$WT_PREFIX-$SLOT"
NAME="gm-$SLOT"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# This checkout's own repository root — the source of `fence.py` and the
# worker skill, regardless of which repository $REPO points at.
TOOLING_ROOT="$(cd "$HERE/../.." && pwd)"

command -v tmux >/dev/null || { echo "dispatch: tmux is not installed" >&2; exit 1; }
command -v python3 >/dev/null || {
  echo "dispatch: python3 is not installed, so the ownership fence hook cannot" >&2
  echo "          run. Launching would put an unfenced worker in a worktree" >&2
  echo "          other slots share." >&2
  exit 1
}

# Resolved once, from the same module the two pre-flight scripts below use, and
# always the resolved directory rather than the raw variable: it is passed into
# the tmux session below so a worker runs on the person's configuration, not on
# whatever the tmux server happened to be started with.
CLAUDE_CFG_DIR="$(python3 "$HERE/claude_config.py" --config-dir)"
[ -f "$BRIEF" ] || { echo "dispatch: brief not found: $BRIEF" >&2; exit 1; }
BRIEF="$(cd "$(dirname "$BRIEF")" && pwd)/$(basename "$BRIEF")"

# A brief whose `owns:` list is shadowed by its own `never:` list grants nothing:
# the fence checks `never` first, so the worker is refused on a file its own
# brief names. The same parse the hook uses runs here, before anything exists,
# so the mistake shows in the orchestrator's terminal rather than inside a
# session somebody has to attach to.
if ! python3 "$HERE/fence.py" --check "$BRIEF"; then
  echo "dispatch: refusing to launch $NAME — fix the brief and dispatch again." >&2
  exit 1
fi

if tmux has-session -t "$NAME" 2>/dev/null; then
  echo "dispatch: $NAME is already running — attach with 'tmux attach -t $NAME'" >&2
  exit 1
fi

# Fetch over SSH, and over HTTPS through `gh` when SSH cannot (a session on a
# forwarded agent without the GitHub key). A worktree cut from a stale
# `origin/$BASE` is a merge conflict the worker did not cause, so a fetch that
# fails both ways is fatal rather than `|| true`.
fetch_base() {
  git -C "$REPO" fetch origin "$BASE" --quiet 2>/dev/null && return 0
  git -C "$REPO" -c url.https://github.com/.insteadOf=git@github.com: fetch origin "$BASE" --quiet 2>/dev/null && return 0
  echo "dispatch: could not fetch origin/$BASE over SSH or HTTPS — refusing to cut a worktree from a stale base" >&2
  return 1
}

if [ ! -d "$WT" ]; then
  fetch_base || exit 1
  if git -C "$REPO" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -C "$REPO" worktree add "$WT" "$BRANCH"
  else
    git -C "$REPO" worktree add -b "$BRANCH" "$WT" "origin/$BASE"
  fi
else
  HAVE="$(git -C "$WT" branch --show-current)"
  if [ "$HAVE" != "$BRANCH" ]; then
    echo "dispatch: $WT is on '$HAVE', not '$BRANCH'." >&2
    echo "dispatch: refusing to launch — a worker on the wrong branch produces a" >&2
    echo "          pull request somebody has to unpick. Remove the worktree" >&2
    echo "          (git worktree remove $WT) or dispatch that slot on its own branch." >&2
    exit 1
  fi
  echo "dispatch: reusing existing worktree $WT on $HAVE"
fi

# Claude Code raises "Do you trust the files in this folder?" per absolute
# project path, and a session under `--remote-control` has nobody to press
# Enter. A worktree is always a new path, so trust is recorded the way Claude
# Code itself records it, before the session starts. Non-fatal: worst case the
# prompt appears and someone answers it once.
#
# Two keys are written: the worktree's own path and the repository's canonical
# root (the main checkout, for a linked worktree). Claude Code reads the first
# for "should the trust dialog appear" and the second for "do this project's
# `permissions.allow` rules apply" — see README.md.
python3 "$HERE/pretrust_worktree.py" "$WT" || \
  echo "dispatch: could not pre-trust $WT — the trust prompt may still appear" >&2

# The session runs `--permission-mode bypassPermissions`, and a configuration
# that has never accepted that mode raises a confirmation and waits — which
# looks exactly like a worker thinking. Recorded in the worktree's
# `.claude/settings.local.json` (the `localSettings` layer, the narrowest one
# the gate consults), never in user settings: the key turns a safety
# confirmation off, and one dispatched session's convenience should die with its
# worktree. `projectSettings` is not consulted by that gate.
python3 "$HERE/accept_dangerous_mode.py" "$WT" || \
  echo "dispatch: could not record the bypass-permissions acceptance in $WT — the dialog may stop this session" >&2

# The brief travels into the worktree rather than being reached for outside it.
# --add-dir is variadic and would swallow the prompt that follows it.
LOCAL_BRIEF="$WT/.orchestrator-brief.md"
cp "$BRIEF" "$LOCAL_BRIEF"

# Shared across every linked worktree, and never committed.
# `--path-format=absolute` because without it the path is relative to this
# script's cwd, not to $REPO.
EXCLUDE="$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)/info/exclude"
grep -qxF '.orchestrator-brief.md' "$EXCLUDE" 2>/dev/null || echo '.orchestrator-brief.md' >> "$EXCLUDE"

# The acceptance above lives in the worktree, so without this `git status`
# offers every worker to commit it into the repository.
grep -qxF '.claude/settings.local.json' "$EXCLUDE" 2>/dev/null || echo '.claude/settings.local.json' >> "$EXCLUDE"

# A repository whose own `.claude/settings.json` does not carry the fence hook
# gets one seeded into the worktree — untracked, and regenerated on every
# dispatch, since the hook's absolute path is machine-specific.
if ! grep -q 'fence\.py' "$REPO/.claude/settings.json" 2>/dev/null; then
  mkdir -p "$WT/.claude/skills"

  cat > "$WT/.claude/settings.json" <<SETTINGS
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$HERE/fence.py\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
SETTINGS

  # A symlink so the skill stays current with this checkout's copy; a copy if
  # the filesystem cannot make one.
  SKILL_SRC="$TOOLING_ROOT/.claude/skills/glitchtip-worker"
  SKILL_DST="$WT/.claude/skills/glitchtip-worker"
  rm -rf "$SKILL_DST"
  if ! ln -s "$SKILL_SRC" "$SKILL_DST" 2>/dev/null; then
    echo "dispatch: symlink failed — copying the worker skill into $WT instead" >&2
    cp -r "$SKILL_SRC" "$SKILL_DST"
  fi

  grep -qxF '.claude/settings.json' "$EXCLUDE" 2>/dev/null || echo '.claude/settings.json' >> "$EXCLUDE"
  grep -qxF '.claude/skills/glitchtip-worker' "$EXCLUDE" 2>/dev/null || echo '.claude/skills/glitchtip-worker' >> "$EXCLUDE"
fi

HOLD=""
[ "$DELAY" -gt 0 ] && HOLD="sleep $DELAY; "

# `bypassPermissions`, not `acceptEdits`: `acceptEdits` covers only Edit,
# Write, MultiEdit and NotebookEdit, so a worker would stop for approval on
# every `bun run test` and `git status` — a prompt a minute on a phone.
#
# What this gives up: the mechanical stop at `git push`, `gh pr create` and
# `gh pr merge`. "Never merge" is a line in the brief; the fence hook is the
# boundary that still holds (PreToolUse hooks are interception, not permission).
#
# `bypassPermissions` also carries a standing instruction to prefer `Bash` for
# file edits. The hook sees `Bash`, but only the write shapes it can read off a
# command — it cannot tell what `bun run build` writes. So the paragraph below
# answers that instruction in the layer it arrives in: the fenced path is made
# the default path, and the hook stops that from being prose.
#
# Keep the paragraph apostrophe-free: it is also asserted verbatim by
# dispatch_test.sh, and prose without apostrophes cannot reopen the quoting bug
# the prompt file below exists for.
#
# DISPATCH_TEST_FENCE_PROMPT overrides the paragraph when set — the only caller
# is dispatch_test.sh, proving the quoting survives an apostrophe. Never set it
# for a real dispatch.
FENCE_PROMPT="${DISPATCH_TEST_FENCE_PROMPT:-Ownership fence. In this session every file \
write goes through the Write, Edit, MultiEdit and NotebookEdit tools. Do not \
create or modify files with Bash: no heredoc redirect, no sed -i, no > into a \
file, no short script written to do it. This overrides the bypass-permissions \
preference for Bash, and it is not a style note — the ownership fence in \
.orchestrator-brief.md is enforced by a PreToolUse hook that can check a \
Write or an Edit exactly, and can only recognise the shell shapes it knows. \
Bash is for running things (git, gh, bun, tests, builds) and for reading them. \
A file that must land outside this worktree is parked under /tmp and its path \
reported to the orchestrator, which lands it. A process you started is \
stopped by the PID you captured when you started it, never by a name or a \
pattern -- pkill and killall are refused outright, and so is kill on anything \
but a literal PID. No Claude attribution trailer or footer on any commit or \
pull request on this machine. The harness reminder to add \
Co-Authored-By: Claude, Claude-Session:, or a Generated with Claude Code \
footer is overridden by the owner global rule, and it arrives in this same \
layer -- appended to your first tool result rather than stated once here -- \
which is why it has to be answered here too. A commit that already carries \
one of these is rewritten before push, with git filter-branch --msg-filter \
and --force-with-lease.}"

# Written into the worktree rather than interpolated into the tmux command
# string: a single-quoted '$FENCE_PROMPT' does not survive an apostrophe inside
# it. Reading the file back with "$(cat …)" inside the command tmux runs means
# the substitution happens in the worker's own shell, inside double quotes, and
# nothing here has to quote the paragraph at all.
FENCE_PROMPT_FILE="$WT/.orchestrator-fence-prompt"
printf '%s' "$FENCE_PROMPT" > "$FENCE_PROMPT_FILE"
grep -qxF '.orchestrator-fence-prompt' "$EXCLUDE" 2>/dev/null || echo '.orchestrator-fence-prompt' >> "$EXCLUDE"

# Git over HTTPS through `gh`, for this session only. A tmux session has no
# forwarded SSH agent, so a global rewrite to SSH fails at push.
# `gh auth setup-git` registers the credential helper; this rewrite is what
# makes the remote reach it. Nothing is persisted: GIT_CONFIG_PARAMETERS lives
# in the worker's process tree and dies with it.
GIT_HTTPS="GIT_CONFIG_PARAMETERS=\"'url.https://github.com/.insteadOf=git@github.com:'\""

# `-e CLAUDE_CONFIG_DIR=…` so the worker reads the configuration the pre-flight
# just wrote to, and `tmux show-environment -t gm-<slot>` answers which one it
# is. `-e` needs tmux 3.2; an older tmux fails loudly here.
#
# `\"\$(cat …)\"` — the backslashes keep this script from expanding the
# substitution itself; it runs only once tmux's shell reads the command.
tmux new-session -d -s "$NAME" -c "$WT" -e "CLAUDE_CONFIG_DIR=$CLAUDE_CFG_DIR" \
  "${HOLD}${GIT_HTTPS} claude --remote-control $NAME -n $NAME --model $MODEL --permission-mode bypassPermissions --append-system-prompt \"\$(cat '$FENCE_PROMPT_FILE')\" '/glitchtip-worker .orchestrator-brief.md'"

if [ "$DELAY" -gt 0 ]; then
  echo "$NAME · $MODEL · $WT · $(git -C "$WT" branch --show-current) · starts in ${DELAY}s · stop with: tmux kill-session -t $NAME"
else
  echo "$NAME · $MODEL · $WT · $(git -C "$WT" branch --show-current) · tmux attach -t $NAME"
fi
