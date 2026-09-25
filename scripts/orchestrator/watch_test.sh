#!/usr/bin/env bash
#
# Regression test for `slots`, `resolve_wt`, `classify_pane` and
# `trailer_in_message`.
#
# `slots`: a session name is everything on the `tmux ls` line up to the first
# `:`, not `[a-z0-9]*` after `gm-` — a character class stops at the first
# hyphen, so `gm-e5-evening` and `gm-e5-review-step` would both come back as
# `e5`, one slot's state reported under the other's name.
#
# `resolve_wt`: a slot's worktree has to be found under either prefix
# `dispatch.sh` can produce — `~/dev/.wt-smart-glitchtip-mcp-<slot>` for the default
# repository, `~/dev/.wt-<basename>-<slot>` for a `GLITCHTIP_MCP_REPO` one — or
# `watch.sh` never sees that worker's reply file or its idle pane at all.
#
# `classify_pane`: a pane sitting on one of Claude Code's launch dialogs carries
# no "esc to interrupt" either, so without a dedicated check it silently reads
# as three polls of IDLE instead of the PROMPT nobody but a person can answer.
#
# Run it directly:
#
#     scripts/orchestrator/watch_test.sh
#
# It builds a throwaway `$HOME` with a worktree under each prefix, sources
# `watch.sh` for its `resolve_wt` and `slots` functions (the file guards its
# own `main` loop behind a `BASH_SOURCE` check so sourcing it runs nothing),
# and asserts on what they resolve and list. `slots` is exercised against a
# stubbed `tmux` on `PATH`, never the real tmux server — this machine's server
# is the live fleet's own. Nothing here touches the repository it lives in.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAKE_HOME="$(mktemp -d)"
trap 'rm -rf "$FAKE_HOME"' EXIT

mkdir -p "$FAKE_HOME/dev/.wt-smart-glitchtip-mcp-a4"
mkdir -p "$FAKE_HOME/dev/.wt-other-repo-u1button"
mkdir -p "$FAKE_HOME/dev/.wt-smart-glitchtip-mcp-e5-evening"
mkdir -p "$FAKE_HOME/dev/.wt-smart-glitchtip-mcp-e5-review-step"

# shellcheck source=/dev/null
source "$HERE/watch.sh"

failures=0

check() {
  local label="$1" slot="$2" expected="$3" got
  got="$(HOME="$FAKE_HOME" resolve_wt "$slot")"
  if [ "$got" = "$expected" ]; then
    echo "ok    $label"
  else
    echo "FAIL  $label: expected '$expected', got '$got'"
    failures=$((failures + 1))
  fi
}

check "the default repository's prefix resolves" \
  "a4" "$FAKE_HOME/dev/.wt-smart-glitchtip-mcp-a4"
check "a GLITCHTIP_MCP_REPO worktree resolves under its own basename prefix" \
  "u1button" "$FAKE_HOME/dev/.wt-other-repo-u1button"
check "a slot with no worktree on either prefix resolves to nothing" \
  "ghost" ""
check "a hyphenated slot resolves to its own worktree, not e5's" \
  "e5-evening" "$FAKE_HOME/dev/.wt-smart-glitchtip-mcp-e5-evening"
check "a second slot sharing the e5 prefix resolves to its own worktree, distinct from the first" \
  "e5-review-step" "$FAKE_HOME/dev/.wt-smart-glitchtip-mcp-e5-review-step"

# slots(): `gm-e5-evening` and `gm-e5-review-step` share the prefix a
# `grep -o '^gm-[a-z0-9]*'` parser would stop at. The fixture is a stubbed `tmux` binary on `PATH`
# rather than a real session — this machine's tmux server is the live fleet's,
# and a test has no business creating or killing a session there. The stub's
# output is the real `tmux ls` line shape (`name: N windows (created ...)`,
# colon-terminated) so the test exercises the same `cut -d: -f1` the fix uses,
# not a shape the old `grep -o` parser would have passed too.
FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_HOME" "$FAKE_BIN"' EXIT
cat > "$FAKE_BIN/tmux" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "ls" ]; then
  cat <<'EOF'
gm-e5-evening: 1 windows (created Fri Sep  4 11:00:00 2026)
gm-e5-review-step: 1 windows (created Fri Sep  4 11:05:00 2026)
gm-f3-schema: 1 windows (created Fri Sep  4 09:00:00 2026)
EOF
  exit 0
fi
exit 1
STUB
chmod +x "$FAKE_BIN/tmux"

slots_expected="e5-evening
e5-review-step
f3-schema"
slots_got="$(PATH="$FAKE_BIN:$PATH" slots)"
if [ "$slots_got" = "$slots_expected" ]; then
  echo "ok    slots() lists two hyphenated sessions sharing a prefix as distinct entries, not one"
else
  echo "FAIL  slots(): expected '$slots_expected', got '$slots_got'"
  failures=$((failures + 1))
fi

BUSY_PANE="│ Reading dispatch.sh…                                          │
  esc to interrupt"

TRUST_PANE="│ Do you trust the files in this folder?                        │
│                                                                 │
│ /home/archi/dev/.wt-other-repo-u1button                          │
│                                                                 │
│ ❯ No, exit                                                     │
│   Yes, I trust this folder                                     │"

IDLE_PANE="│ >                                                              │
│                                                                 │"

# The bypass-permissions dialog, verbatim from a pane that stopped a slot —
# `dispatch.sh` exited 0, the session was live, and this read as IDLE.
BYPASS_PANE="│ WARNING: Claude Code running in Bypass Permissions mode         │
│                                                                 │
│ In Bypass Permissions mode, Claude Code will not ask for your   │
│ approval before running potentially dangerous commands.         │
│                                                                 │
│ ❯ No, exit                                                     │
│   Yes, I accept                                                │"

# The same dialog with the title scrolled off, which is what a narrow or
# already-busy pane shows. The body line has to be enough on its own.
BYPASS_PANE_BODY_ONLY="│ In Bypass Permissions mode, Claude Code will not ask for your   │
│ approval before running potentially dangerous commands.         │
│                                                                 │
│ ❯ No, exit                                                     │"

# The usage-credits dialog, captured verbatim: a `fable` slot — the model
# `dispatch.sh` defaults to — went cleanly past both recorded dialogs and
# stopped here instead. No pre-flight can
# record a billing state away, so being woken is the entire remedy.
#
# The pre-approved-permission dialog, captured verbatim from a dispatch against a fresh
# `CLAUDE_CONFIG_DIR`. A trust-dialog variant raised by this repository's own
# pre-approved tool permission, and it shares no wording with the plain trust
# dialog above — `hasTrustDialogAccepted: true` does not suppress it either, so
# without its own patterns it reads as three polls of IDLE.
PREAPPROVED_PANE=" Quick safety check: Is this a project you created or one you trust? (Like your
 own code, a well-known open source project, or work from your team). If not,
 take a moment to review what's in this folder first.
 ⚠ This folder pre-approves 1 tool permission in .claude/settings.json:
   Bash(gh pr merge:*)
 These will apply without asking. Only proceed if you trust this configuration.
 ❯ No, continue without these permissions
   Yes, I trust this folder"

# The same dialog scrolled past its opening line, so the ⚠ line carries it alone.
PREAPPROVED_PANE_WARN_ONLY=" ⚠ This folder pre-approves 1 tool permission in .claude/settings.json:
   Bash(gh pr merge:*)
 ❯ No, continue without these permissions
   Yes, I trust this folder"

CREDITS_PANE="  Fable 5.1 now uses usage credits
  Fable 5.1 runs on usage credits — you have \$0.00 in credits.
  Learn more: https://support.claude.com/en/articles/12429409-extra-usage-for-
  paid-claude-plans
  ❯ Switch to Sonnet 5 and continue
    Manage usage credits on claude.ai
  Enter to confirm · Esc to cancel"

check_pane() {
  local label="$1" pane="$2" idle_in="$3" prompt_in="$4" expected="$5" got
  got="$(classify_pane "$pane" "$idle_in" "$prompt_in")"
  if [ "$got" = "$expected" ]; then
    echo "ok    $label"
  else
    echo "FAIL  $label: expected '$expected', got '$got'"
    failures=$((failures + 1))
  fi
}

check_pane "a busy pane resets idle count and reports nothing" \
  "$BUSY_PANE" 2 0 "NONE 0 0"
check_pane "the trust dialog fires PROMPT the first time it is seen" \
  "$TRUST_PANE" 0 0 "PROMPT 0 1"
check_pane "the trust dialog stays silent on the next poll" \
  "$TRUST_PANE" 0 1 "NONE 0 1"
check_pane "an idle, non-dialog pane counts toward IDLE and clears prompt_seen" \
  "$IDLE_PANE" 2 1 "IDLE 3 0"
check_pane "an idle pane below the threshold reports nothing yet" \
  "$IDLE_PANE" 1 0 "NONE 2 0"
check_pane "the bypass-permissions dialog fires PROMPT the first time it is seen" \
  "$BYPASS_PANE" 2 0 "PROMPT 0 1"
check_pane "the bypass-permissions dialog stays silent on the next poll" \
  "$BYPASS_PANE" 0 1 "NONE 0 1"
check_pane "the bypass-permissions dialog is caught from its body line alone" \
  "$BYPASS_PANE_BODY_ONLY" 0 0 "PROMPT 0 1"
check_pane "the usage-credits dialog fires PROMPT instead of counting toward IDLE" \
  "$CREDITS_PANE" 2 0 "PROMPT 0 1"
check_pane "the usage-credits dialog stays silent on the next poll" \
  "$CREDITS_PANE" 0 1 "NONE 0 1"
check_pane "the pre-approved-permissions trust variant fires PROMPT, not IDLE" \
  "$PREAPPROVED_PANE" 2 0 "PROMPT 0 1"
check_pane "the pre-approved-permissions variant is caught from its warning line alone" \
  "$PREAPPROVED_PANE_WARN_ONLY" 0 0 "PROMPT 0 1"

# trailer_in_message: the harness appends this reminder to a worker's own
# first tool result, so the fixture is its exact wording rather than a
# paraphrase — a check that only matches a paraphrase would miss the real one.
check_trailer() {
  local label="$1" msg="$2" expected="$3" got
  if trailer_in_message "$msg"; then got=1; else got=0; fi
  if [ "$got" = "$expected" ]; then
    echo "ok    $label"
  else
    echo "FAIL  $label: expected '$expected', got '$got'"
    failures=$((failures + 1))
  fi
}

check_trailer "a Co-Authored-By: Claude trailer is caught" \
  "fix: tighten the retry window

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>" 1
check_trailer "a Claude-Session trailer is caught on its own" \
  "fix: tighten the retry window

Claude-Session: https://claude.ai/code/session_015DLzY5dnxvibqAEZ3JmMMK" 1
check_trailer "a plain commit message with neither trailer is left alone" \
  "fix: tighten the retry window" 0
check_trailer "Co-Authored-By for a human is not a Claude trailer" \
  "fix: tighten the retry window

Co-Authored-By: A Teammate <teammate@example.com>" 0

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "22 passed"
