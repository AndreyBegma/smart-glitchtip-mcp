#!/usr/bin/env bash
#
# Regression test for `dispatch.sh`'s pre-flight — the two things it records
# before a worker's session starts, so that nobody has to press Down + Enter on
# a dialog in a detached tmux pane:
#
#   `pretrust_worktree.py`      the trust-folder dialog, and
#                               its permission-disclosure variant, which needs a
#                               second key
#   `accept_dangerous_mode.py`  the bypass-permissions dialog
#
# and, running through both, which configuration file each one writes to.
#
# Run it directly:
#
#     scripts/orchestrator/dispatch_test.sh
#
# It drives the script against a fixture `~/.claude.json` and asserts: the
# new path gets `hasTrustDialogAccepted: true`, every other project entry and
# every other top-level key comes back with the same values it went in with,
# an existing entry for the same path keeps its other fields, and a missing
# file is skipped rather than created.
#
# Cases 5-7 cover which file the script picks when no path is passed:
# `$CLAUDE_CONFIG_DIR/.claude.json` when that is set,
# `$HOME/.claude.json` when it is not — and not `$HOME/.claude/.claude.json`,
# which is the asymmetry with `settings.json` that `claude_config.py` exists to
# hold in one place.
#
# Nothing here touches the repository it lives in, the real `~/.claude.json`,
# or the real `$CLAUDE_CONFIG_DIR` — every case runs against a fixture `$HOME`.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/pretrust_worktree.py"
FIXTURE_DIR="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_DIR"' EXIT

failures=0

check() {
  local label="$1" ok="$2"
  if [ "$ok" = "1" ]; then
    echo "ok    $label"
  else
    echo "FAIL  $label"
    failures=$((failures + 1))
  fi
}

py() {
  # Small helpers run inline rather than as more fixture files — each is one
  # throwaway question about the JSON on disk, asked once.
  python3 -c "$1"
}

# --- case 1: a brand-new path is added, and untouched state survives -------
CLAUDE_JSON="$FIXTURE_DIR/claude.json"
cat > "$CLAUDE_JSON" <<'JSON'
{
  "numStartups": 42,
  "oauthAccount": {"emailAddress": "user@example.com"},
  "projects": {
    "/home/archi/dev/.wt-smart-glitchtip-mcp-a4": {
      "hasTrustDialogAccepted": true,
      "lastCost": 1.23
    },
    "/home/archi/dev/.wt-smart-glitchtip-mcp-r12": {
      "hasTrustDialogAccepted": false
    }
  }
}
JSON
ORIGINAL_MODE="$(stat -c %a "$CLAUDE_JSON")"

NEW_PATH="/home/archi/dev/.wt-other-repo-o1"
python3 "$SCRIPT" "$NEW_PATH" "$CLAUDE_JSON"

GOT="$(py "
import json
d = json.load(open('$CLAUDE_JSON'))
print(d['projects']['$NEW_PATH']['hasTrustDialogAccepted'])
")"
check "a new path is recorded trusted" "$([ "$GOT" = "True" ] && echo 1 || echo 0)"

SURVIVED="$(py "
import json
d = json.load(open('$CLAUDE_JSON'))
ok = (
    d.get('numStartups') == 42
    and d.get('oauthAccount', {}).get('emailAddress') == 'user@example.com'
    and d['projects']['/home/archi/dev/.wt-smart-glitchtip-mcp-a4'] == {'hasTrustDialogAccepted': True, 'lastCost': 1.23}
    and d['projects']['/home/archi/dev/.wt-smart-glitchtip-mcp-r12'] == {'hasTrustDialogAccepted': False}
)
print(1 if ok else 0)
")"
check "every other top-level key and project entry survives unchanged" "$SURVIVED"

NEW_MODE="$(stat -c %a "$CLAUDE_JSON")"
check "the file's mode is unchanged" "$([ "$NEW_MODE" = "$ORIGINAL_MODE" ] && echo 1 || echo 0)"

# --- case 2: an existing entry for the same path keeps its other fields ----
EXISTING_PATH="/home/archi/dev/.wt-smart-glitchtip-mcp-a4"
python3 "$SCRIPT" "$EXISTING_PATH" "$CLAUDE_JSON"
GOT2="$(py "
import json
d = json.load(open('$CLAUDE_JSON'))
e = d['projects']['$EXISTING_PATH']
print(1 if (e['hasTrustDialogAccepted'] is True and e['lastCost'] == 1.23) else 0)
")"
check "an already-trusted entry's other fields survive re-running" "$GOT2"

# --- case 3: a false entry for a fresh path flips to true ------------------
python3 "$SCRIPT" "/home/archi/dev/.wt-smart-glitchtip-mcp-r12" "$CLAUDE_JSON"
GOT3="$(py "
import json
d = json.load(open('$CLAUDE_JSON'))
print(d['projects']['/home/archi/dev/.wt-smart-glitchtip-mcp-r12']['hasTrustDialogAccepted'])
")"
check "an explicitly-untrusted entry is flipped to trusted" "$([ "$GOT3" = "True" ] && echo 1 || echo 0)"

# --- case 4: no ~/.claude.json — skip silently, create nothing -------------
MISSING="$FIXTURE_DIR/does-not-exist.json"
python3 "$SCRIPT" "/home/archi/dev/.wt-smart-glitchtip-mcp-ghost" "$MISSING"
check "a missing claude.json is skipped, not created" "$([ ! -e "$MISSING" ] && echo 1 || echo 0)"

# --- cases 5-7: the default target, with and without CLAUDE_CONFIG_DIR -----
#
# The script used to hardcode `~/.claude.json`, so on a
# machine with `CLAUDE_CONFIG_DIR` set — this one — the trust was written to a
# file Claude Code does not read and the dialog was one environment variable
# away from stopping every dispatch. Both fixture files exist here, so the only
# thing under test is *which* of the two gets written.
#
# Case 7 is the asymmetry that makes `claude_config.py` worth having: with the
# variable unset the config file is `$HOME/.claude.json`, and specifically not
# `$HOME/.claude/.claude.json`, even though `settings.json` *does* live in that
# directory. A resolver that joined the config dir for both would write trust
# into a file nothing reads and pass a test that only checked the set case.
FAKE_HOME="$FIXTURE_DIR/home"
PROFILE="$FIXTURE_DIR/profile"
mkdir -p "$FAKE_HOME/.claude" "$PROFILE"
for f in "$FAKE_HOME/.claude.json" "$FAKE_HOME/.claude/.claude.json" "$PROFILE/.claude.json"; do
  echo '{"projects": {}}' > "$f"
done

SLOT_PATH="/home/archi/dev/.wt-smart-glitchtip-mcp-cfgdir"

trusted_in() {
  # 1 when the fixture at $1 records $SLOT_PATH as trusted, 0 otherwise.
  py "
import json
d = json.load(open('$1'))
print(1 if d['projects'].get('$SLOT_PATH', {}).get('hasTrustDialogAccepted') is True else 0)
"
}

HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$PROFILE" python3 "$SCRIPT" "$SLOT_PATH"
check "with CLAUDE_CONFIG_DIR set, trust lands in \$CLAUDE_CONFIG_DIR/.claude.json" \
  "$(trusted_in "$PROFILE/.claude.json")"
check "with CLAUDE_CONFIG_DIR set, \$HOME/.claude.json is left alone" \
  "$([ "$(trusted_in "$FAKE_HOME/.claude.json")" = "0" ] && echo 1 || echo 0)"

HOME="$FAKE_HOME" env -u CLAUDE_CONFIG_DIR python3 "$SCRIPT" "$SLOT_PATH"
check "with CLAUDE_CONFIG_DIR unset, trust lands in \$HOME/.claude.json and not \$HOME/.claude/.claude.json" \
  "$([ "$(trusted_in "$FAKE_HOME/.claude.json")" = "1" ] \
     && [ "$(trusted_in "$FAKE_HOME/.claude/.claude.json")" = "0" ] && echo 1 || echo 0)"

# --- cases 8-15: the bypass-permissions acceptance ------------------------
#
# The other half. `skipDangerousModePermissionPrompt` is what
# tells Claude Code the bypass-permissions dialog has been accepted; without it a
# worker started with `--permission-mode bypassPermissions` sits on that dialog
# while the launcher exits 0 and `watch.sh` reports IDLE.
#
# It is written into the worktree — `localSettings` — and not into the person's
# user settings, so the mechanics below (create, merge, no-op, refuse-if-unparseable)
# are exercised through an explicit path argument, and cases 13-15 then check that
# the *default* path is the worktree's and that no user settings file acquires the
# key.
ACCEPT="$HERE/accept_dangerous_mode.py"
# Stands in for a worktree in the cases that pass an explicit settings path; the
# script takes `<worktree> [settings-path]` and the override is what the
# mechanics cases drive.
ACCEPT_WT="$FIXTURE_DIR/mechanics-worktree"

accepted_in() {
  # 1 when the fixture at $1 records the acceptance, 0 when it does not or is absent.
  py "
import json, os
p = '$1'
if not os.path.isfile(p):
    print(0)
else:
    d = json.load(open(p))
    print(1 if d.get('skipDangerousModePermissionPrompt') is True else 0)
"
}

# Case 8. The file *and its directory* are created when absent — unlike
# pre-trusting, which skips. A fresh worktree never has local settings, so
# skipping when the file is absent would mean never writing it at all.
FRESH="$FIXTURE_DIR/fresh-worktree/.claude/settings.local.json"
python3 "$ACCEPT" "$ACCEPT_WT" "$FRESH"
check "a missing settings file is created, with the acceptance recorded" \
  "$(accepted_in "$FRESH")"
check "a created settings file gets 0644, as Claude Code's own do" \
  "$([ "$(stat -c %a "$FRESH")" = "644" ] && echo 1 || echo 0)"

# Case 10. An existing file keeps everything else in it.
SETTINGS="$FIXTURE_DIR/settings.json"
cat > "$SETTINGS" <<'JSON'
{
  "model": "opus[1m]",
  "theme": "dark-daltonized",
  "verbose": true
}
JSON
python3 "$ACCEPT" "$ACCEPT_WT" "$SETTINGS"
check "an existing settings file keeps every other key" \
  "$(py "
import json
d = json.load(open('$SETTINGS'))
ok = (
    d.get('skipDangerousModePermissionPrompt') is True
    and d.get('model') == 'opus[1m]'
    and d.get('theme') == 'dark-daltonized'
    and d.get('verbose') is True
)
print(1 if ok else 0)
")"

# Case 11. Already recorded is a no-op. `dispatch.sh` re-dispatches into an
# existing worktree, so this path gets walked. The write is an atomic rename, so
# an unchanged inode is proof none happened.
INODE_BEFORE="$(stat -c %i "$SETTINGS")"
python3 "$ACCEPT" "$ACCEPT_WT" "$SETTINGS"
check "an already-recorded acceptance does not rewrite the file" \
  "$([ "$(stat -c %i "$SETTINGS")" = "$INODE_BEFORE" ] && echo 1 || echo 0)"

# Case 12. A settings file that does not parse is left completely alone and the
# script fails instead. Overwriting a settings file nobody could read would be a
# worse outcome than the dialog this is here to prevent.
BAD="$FIXTURE_DIR/bad-settings.json"
printf '{ this is not json\n' > "$BAD"
BAD_BEFORE="$(cat "$BAD")"
if python3 "$ACCEPT" "$ACCEPT_WT" "$BAD" 2>/dev/null; then BAD_RC=0; else BAD_RC=1; fi
check "an unparseable settings file fails loudly and is left byte-for-byte alone" \
  "$([ "$BAD_RC" = "1" ] && [ "$(cat "$BAD")" = "$BAD_BEFORE" ] && echo 1 || echo 0)"

# Cases 13-15. The default target is the worktree's own `localSettings`, and no
# settings file outside the worktree is touched — which is the whole point of
# writing it there. `$FAKE_HOME` and `$PROFILE` are the fixtures built for cases
# 5-7, and both already hold a `settings.json`; neither may acquire the key.
WT_FIXTURE="$FIXTURE_DIR/worktree"
mkdir -p "$WT_FIXTURE"
HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$PROFILE" python3 "$ACCEPT" "$WT_FIXTURE"
check "the default target is the worktree's own .claude/settings.local.json" \
  "$(accepted_in "$WT_FIXTURE/.claude/settings.local.json")"
check "the user settings file is left without the key, in either config dir" \
  "$([ "$(accepted_in "$PROFILE/settings.json")" = "0" ] \
     && [ "$(accepted_in "$FAKE_HOME/.claude/settings.json")" = "0" ] && echo 1 || echo 0)"

# A worktree that already carries local settings keeps them. `dispatch.sh`
# re-dispatches into an existing worktree, so this is a path that gets walked.
cat > "$WT_FIXTURE/.claude/settings.local.json" <<'JSON'
{
  "permissions": {"allow": ["Bash(git status)"]}
}
JSON
python3 "$ACCEPT" "$WT_FIXTURE"
check "an existing settings.local.json keeps what the worktree already had" \
  "$(py "
import json
d = json.load(open('$WT_FIXTURE/.claude/settings.local.json'))
ok = (
    d.get('skipDangerousModePermissionPrompt') is True
    and d.get('permissions', {}).get('allow') == ['Bash(git status)']
)
print(1 if ok else 0)
")"

# --- cases 18-22: the second trust key, on a real linked worktree ---------
#
# Claude Code decides "should the trust dialog appear" from
# either the canonical git root or a walk up from cwd, but decides "do this
# project's permissions.allow rules apply, and is the disclosure backstop owed"
# from the canonical git root alone — and for a linked worktree that root is the
# **main checkout**, not the worktree. Recording only the worktree satisfied the
# first check and not the second, so a fresh `CLAUDE_CONFIG_DIR` raised
#
#     Quick safety check: … This folder pre-approves 1 tool permission …
#
# with the cancel label Claude Code only renders when trust *is* accepted, which
# is exactly why `hasTrustDialogAccepted: true` looked like it did not work.
#
# A real `git worktree add` rather than a hand-built fixture: the layout under
# test is `.git/worktrees/<name>` with its `commondir` indirection, and a fake
# of it would only prove the fake matches the assertion.
REPO_FIXTURE="$FIXTURE_DIR/repo"
mkdir -p "$REPO_FIXTURE"
git init --quiet -b main "$REPO_FIXTURE"
git -C "$REPO_FIXTURE" -c user.email=t@example.com -c user.name=t \
  commit --quiet --allow-empty -m "root"
LINKED_WT="$FIXTURE_DIR/linked-wt"
git -C "$REPO_FIXTURE" worktree add --quiet -b slot "$LINKED_WT" main

# `canonical_git_root` resolves symlinks, as Claude Code's own canonicalisation
# does, so the expectation has to be resolved too — `/tmp` is a symlink on some
# distributions and the raw fixture path would then never match.
REPO_REAL="$(realpath "$REPO_FIXTURE")"
LINKED_REAL="$(realpath "$LINKED_WT")"

TWO_KEY_JSON="$FIXTURE_DIR/two-key.json"
echo '{"projects": {}}' > "$TWO_KEY_JSON"
python3 "$SCRIPT" "$LINKED_WT" "$TWO_KEY_JSON"

check "a linked worktree records the worktree's own path" \
  "$(py "
import json
d = json.load(open('$TWO_KEY_JSON'))
print(1 if d['projects'].get('$LINKED_WT', {}).get('hasTrustDialogAccepted') is True else 0)
")"
check "a linked worktree also records the main checkout — the strict-trust key" \
  "$(py "
import json
d = json.load(open('$TWO_KEY_JSON'))
print(1 if d['projects'].get('$REPO_REAL', {}).get('hasTrustDialogAccepted') is True else 0)
")"

# The main checkout of a repository is its own canonical root; one key, not the
# same key written twice under two spellings.
MAIN_KEY_JSON="$FIXTURE_DIR/main-key.json"
echo '{"projects": {}}' > "$MAIN_KEY_JSON"
python3 "$SCRIPT" "$REPO_REAL" "$MAIN_KEY_JSON"
check "the main checkout records exactly one key" \
  "$(py "
import json
d = json.load(open('$MAIN_KEY_JSON'))
print(1 if list(d['projects']) == ['$REPO_REAL'] else 0)
")"

# A directory git knows nothing about still gets its own key and nothing else —
# the `GLITCHTIP_MCP_REPO` other-repository case must not depend on there being a
# root to find, and a `None` from git must cost the caller nothing.
PLAIN_DIR="$FIXTURE_DIR/not-a-repo"
mkdir -p "$PLAIN_DIR"
PLAIN_JSON="$FIXTURE_DIR/plain.json"
echo '{"projects": {}}' > "$PLAIN_JSON"
python3 "$SCRIPT" "$PLAIN_DIR" "$PLAIN_JSON"
check "a directory outside any repository records only its own path" \
  "$(py "
import json
d = json.load(open('$PLAIN_JSON'))
print(1 if list(d['projects']) == ['$PLAIN_DIR'] else 0)
")"

# The CLI form, because `dispatch.sh` is not the only thing that will ever want
# to ask, and a resolver nobody can query by hand is one people re-derive.
CLI_ROOT="$(python3 "$HERE/claude_config.py" --canonical-git-root "$LINKED_WT")"
CLI_OUTSIDE=0
python3 "$HERE/claude_config.py" --canonical-git-root "$PLAIN_DIR" >/dev/null 2>&1 \
  || CLI_OUTSIDE=1
check "claude_config.py --canonical-git-root answers the main checkout, and fails outside a repository" \
  "$([ "$CLI_ROOT" = "$REPO_REAL" ] && [ "$CLI_OUTSIDE" = "1" ] \
     && [ "$LINKED_REAL" != "$REPO_REAL" ] && echo 1 || echo 0)"

# --- case 23: the launched command carries the no-attribution sentence, ---
# --- parsed the way tmux's own shell would parse it   ---
#
# The `--append-system-prompt` is the only lever that reaches
# a worker before its first tool call, which is where the harness's own
# attribution reminder (`Co-Authored-By: Claude`, `Claude-Session:`, "Generated
# with Claude Code") arrives.
#
# Grepping the raw string `dispatch.sh` hands to `tmux new-session` is exactly
# what once let a bug through: the command was truncated by an apostrophe
# inside `FENCE_PROMPT`, but the surviving fragment still contained the words
# "no Claude attribution", so the grep passed while the task argument the
# worker actually received was garbage. Proving the fix means parsing the
# command the way tmux's own shell does — the fake `tmux` below `eval`s the
# same string a real one would hand to `$SHELL -c`, with a fake `claude` on
# `PATH` ahead of it that dumps its own argv (one per line) to a file. Case 23
# then asserts against *that* argv, not the pre-parse string.
DISPATCH="$HERE/dispatch.sh"
DISPATCH_HOME="$FIXTURE_DIR/dispatch-home"
mkdir -p "$DISPATCH_HOME/dev" "$DISPATCH_HOME/.claude"

# A local `origin`, so `fetch_base` succeeds without the network: a plain repo
# with a `develop` branch (the default base), cloned the way `dispatch.sh`
# expects `origin` to already be set up. The two launches below pass no base
# argument, so they also prove the default is `develop`.
ORIGIN_FIXTURE="$FIXTURE_DIR/dispatch-origin"
git init --quiet -b develop "$ORIGIN_FIXTURE"
git -C "$ORIGIN_FIXTURE" -c user.email=t@example.com -c user.name=t \
  commit --quiet --allow-empty -m "root"
DISPATCH_REPO="$FIXTURE_DIR/dispatch-repo"
git clone --quiet "$ORIGIN_FIXTURE" "$DISPATCH_REPO"

# A minimal brief `fence.py --check` accepts — the pre-flight only reads
# `owns:`/`never:` for self-contradiction, not the paths of a real worktree.
DISPATCH_BRIEF="$FIXTURE_DIR/dispatch-brief.md"
cat > "$DISPATCH_BRIEF" <<'BRIEF'
owns:
  - fixture-owned-file.txt
BRIEF

# A fake `tmux` ahead of the real one on `PATH`: `has-session` says no session
# exists yet; `new-session` records its full argument list (for diagnosis) and
# then `eval`s the last argument — the command string — exactly as a real
# `tmux` would hand it to the session's shell, so `$(cat …)`, quoting and all,
# actually runs.
FAKE_BIN="$FIXTURE_DIR/dispatch-bin"
mkdir -p "$FAKE_BIN"
TMUX_CAPTURE="$FIXTURE_DIR/tmux-new-session.txt"
cat > "$FAKE_BIN/tmux" <<TMUXEOF
#!/usr/bin/env bash
case "\$1" in
  has-session) exit 1 ;;
  new-session)
    printf '%s\n' "\$@" > "$TMUX_CAPTURE"
    eval "\${@: -1}"
    exit 0
    ;;
  *) exit 0 ;;
esac
TMUXEOF
chmod +x "$FAKE_BIN/tmux"

# A fake `claude`, run by the `eval` above exactly as the real launch would run
# it, that dumps its own argv — one per line, so an apostrophe or a newline
# inside an argument cannot be confused with the separator between arguments —
# to a file instead of starting a session.
CLAUDE_ARGV="$FIXTURE_DIR/claude-argv.txt"
cat > "$FAKE_BIN/claude" <<CLAUDEEOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$CLAUDE_ARGV"
CLAUDEEOF
chmod +x "$FAKE_BIN/claude"

# The value `--append-system-prompt` is followed by, and the argument after it
# — order matters here, not just presence, since a truncated prompt swallowing
# the task argument is exactly how the quoting bug shipped.
prompt_arg() {
  py "
lines = open('$CLAUDE_ARGV').read().split(chr(10))[:-1]
i = lines.index('--append-system-prompt')
print(lines[i + 1])
"
}

last_argv() {
  py "
lines = open('$CLAUDE_ARGV').read().split(chr(10))[:-1]
print(lines[-1])
"
}

# The exact paragraph `dispatch.sh` carries today — kept apostrophe-free,
# so this string and the one in `dispatch.sh` have to be
# updated together, which is the point: a future edit that reintroduces an
# apostrophe here is a future edit that has to look at this test too.
EXPECTED_FENCE_PROMPT="Ownership fence. In this session every file write goes through the Write, Edit, MultiEdit and NotebookEdit tools. Do not create or modify files with Bash: no heredoc redirect, no sed -i, no > into a file, no short script written to do it. This overrides the bypass-permissions preference for Bash, and it is not a style note — the ownership fence in .orchestrator-brief.md is enforced by a PreToolUse hook that can check a Write or an Edit exactly, and can only recognise the shell shapes it knows. Bash is for running things (git, gh, bun, tests, builds) and for reading them. A file that must land outside this worktree is parked under /tmp and its path reported to the orchestrator, which lands it. A process you started is stopped by the PID you captured when you started it, never by a name or a pattern -- pkill and killall are refused outright, and so is kill on anything but a literal PID. No Claude attribution trailer or footer on any commit or pull request on this machine. The harness reminder to add Co-Authored-By: Claude, Claude-Session:, or a Generated with Claude Code footer is overridden by the owner global rule, and it arrives in this same layer -- appended to your first tool result rather than stated once here -- which is why it has to be answered here too. A commit that already carries one of these is rewritten before push, with git filter-branch --msg-filter and --force-with-lease."

HOME="$DISPATCH_HOME" PATH="$FAKE_BIN:$PATH" GLITCHTIP_MCP_REPO="$DISPATCH_REPO" \
  CLAUDE_CONFIG_DIR="$DISPATCH_HOME/.claude" \
  "$DISPATCH" trailers fix/dispatch-trailers-fixture "$DISPATCH_BRIEF" sonnet \
  >/dev/null 2>&1

check "the launched command carries the no-attribution sentence" \
  "$([ -f "$CLAUDE_ARGV" ] && grep -qi 'no Claude attribution' "$CLAUDE_ARGV" && echo 1 || echo 0)"
check "--append-system-prompt carries the whole paragraph, unchanged" \
  "$([ "$(prompt_arg)" = "$EXPECTED_FENCE_PROMPT" ] && echo 1 || echo 0)"
check "the task argument is exactly /glitchtip-worker .orchestrator-brief.md" \
  "$([ "$(last_argv)" = "/glitchtip-worker .orchestrator-brief.md" ] && echo 1 || echo 0)"

# An apostrophe injected into the prompt — the exact shape that once broke
# the launch — must still reach `claude` intact and must not swallow the
# task argument that follows it. `DISPATCH_TEST_FENCE_PROMPT` is dispatch.sh's
# own test-only override, read only when this variable is set.
APOSTROPHE_PROMPT="The harness's reminder and the owner's rule both carry an apostrophe now."
rm -f "$CLAUDE_ARGV" "$TMUX_CAPTURE"
HOME="$DISPATCH_HOME" PATH="$FAKE_BIN:$PATH" GLITCHTIP_MCP_REPO="$DISPATCH_REPO" \
  CLAUDE_CONFIG_DIR="$DISPATCH_HOME/.claude" \
  DISPATCH_TEST_FENCE_PROMPT="$APOSTROPHE_PROMPT" \
  "$DISPATCH" trailers2 fix/dispatch-trailers-fixture-2 "$DISPATCH_BRIEF" sonnet \
  >/dev/null 2>&1

check "an apostrophe injected into the prompt reaches claude intact" \
  "$([ "$(prompt_arg)" = "$APOSTROPHE_PROMPT" ] && echo 1 || echo 0)"
check "an apostrophe in the prompt does not swallow the task argument" \
  "$([ "$(last_argv)" = "/glitchtip-worker .orchestrator-brief.md" ] && echo 1 || echo 0)"

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "27 passed"
