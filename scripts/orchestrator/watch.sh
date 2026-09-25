#!/usr/bin/env bash
#
# The orchestrator's alarm clock. Run it under the `Monitor` tool, persistent.
#
#   scripts/orchestrator/watch.sh [poll-seconds] [heartbeat-seconds]
#
# Every stdout line is an event that wakes the orchestrator. It emits on exactly
# the things Phase 8 acts on, and nothing else:
#
#   PR-CHANGED <n> <branch> <checks>   a pull request appeared, or its checks moved
#   PR-GONE <n> <branch>               a pull request left the open list (merged or closed)
#   REPLY-CHANGED <slot>: <last h2>    a worker wrote to .orchestrator-reply.md
#   PROMPT <slot>                      a pane is sitting on a Claude Code launch dialog
#                                      (trust-folder, or the bypass-permissions acceptance)
#   IDLE <slot>                        a worker's prompt has sat empty for three polls
#   SESSIONS-CHANGED was[...] now[...] a gm-* session appeared or died
#   QUOTA-HIT <slot>                   the weekly-limit banner is on a worker's pane
#   TRAILER <slot> <sha>               a slot's branch head carries a Claude
#                                      attribution trailer
#   HEARTBEAT <HH:MM> slots[...]       nothing happened for a while — go and look anyway
#
# Why this exists: the peer channel (`SendMessage`, `notify_when_idle`) is held
# for the person's approval in both directions, so it cannot wake anybody.
# Silence is not progress. This script is what makes the orchestrator exist
# between messages.
#
# Slots are discovered from `tmux ls`; nothing is configured.
#
# A slot's worktree is `~/dev/.wt-<repo basename>-<slot>` (`dispatch.sh`'s
# rule; `~/dev/.wt-smart-glitchtip-mcp-<slot>` for the default repository). This
# script only ever has the slot name, so `resolve_wt` tries the default prefix
# first and falls back to whatever else matches — one worktree per slot in
# practice, so the first match is the only one there is.
resolve_wt() {
  local slot="$1" candidate
  if [ -d "$HOME/dev/.wt-smart-glitchtip-mcp-$slot" ]; then
    printf '%s\n' "$HOME/dev/.wt-smart-glitchtip-mcp-$slot"
    return
  fi
  for candidate in "$HOME"/dev/.wt-*-"$slot"; do
    [ -d "$candidate" ] && { printf '%s\n' "$candidate"; return; }
  done
  return 0
}

set -u

slots() { tmux ls 2>/dev/null | cut -d: -f1 | grep '^gm-' | sed 's/^gm-//' | sort; }

# Pure classifier, so a fixture pane capture can drive it without a real tmux
# session. A pane sitting on one of Claude Code's launch dialogs carries no
# "esc to interrupt" either, so without checking for it first the dialog reads
# as three polls of silence and reports IDLE — nothing tells the orchestrator
# someone has to press Enter. Prints "<event> <idle_count> <prompt_seen>";
# event is NONE, PROMPT or IDLE. PROMPT fires once per occurrence, on the poll
# the dialog first appears — nobody else can dismiss it.
#
# The dialogs, one event:
#   - trust-folder, and its "Quick safety check … pre-approves N tool
#     permission" variant (raised when the repository's `.claude/settings.json`
#     pre-approves a tool and the canonical-root trust key is missing — see
#     README.md's two-key table);
#   - the bypass-permissions acceptance;
#   - "<model> now uses usage credits", a billing state no pre-flight can
#     record away, so reporting it is the whole remedy.
# `dispatch.sh` pre-records the first two, so reaching either means the
# pre-flight did not take — which is exactly the case being woken is for.
#
# The patterns are the dialogs' own wording, loose enough to survive a pane
# wrap — so a pane merely *displaying* this text reports PROMPT. On purpose: a
# false PROMPT costs one look at a pane; a missed one costs a slot that sits on
# a dialog reporting IDLE.
DIALOG_PATTERNS='Do you trust the files in this folder|Quick safety check|pre-approves|Bypass Permissions mode, Claude Code will not ask|WARNING: Claude Code running in Bypass Permissions mode|now uses usage credits|Manage usage credits on claude\.ai'

classify_pane() {
  local pane="$1" idle_count="$2" prompt_seen="$3" event=NONE
  if grep -qE "$DIALOG_PATTERNS" <<<"$pane"; then
    [ "$prompt_seen" = "1" ] || event=PROMPT
    prompt_seen=1
    idle_count=0
  elif grep -q "esc to interrupt" <<<"$pane"; then
    idle_count=0
    prompt_seen=0
  else
    prompt_seen=0
    idle_count=$((idle_count + 1))
    [ "$idle_count" -eq 3 ] && event=IDLE
  fi
  printf '%s %s %s\n' "$event" "$idle_count" "$prompt_seen"
}

# Pure, so `watch_test.sh` can drive it on a commit message fixture without a
# real git history — same reason `classify_pane` is separated from `main`.
# The trailer comes from the harness's own attribution reminder, not the worker.
trailer_in_message() {
  grep -qiE '^(Co-Authored-By: Claude|Claude-Session:)' <<<"$1"
}

main() {
POLL=${1:-45}
HEARTBEAT=${2:-1200}
REPO=${GLITCHTIP_MCP_GH_REPO:-AndreyBegma/smart-glitchtip-mcp}
STATE=${TMPDIR:-/tmp}/smart-glitchtip-mcp-watch.$$
mkdir -p "$STATE"
trap 'rm -rf "$STATE"' EXIT

declare -A reply_mtime idle_count prompt_seen head_sha
prev_sessions=""
last_event=$(date +%s)

while true; do
  fired=0

  # --- pull requests: appeared, checks moved, left the open list
  gh pr list --repo "$REPO" --state open --limit 30 \
    --json number,headRefName,statusCheckRollup \
    -q '.[] | "\(.number) \(.headRefName) \([.statusCheckRollup[]?|.conclusion // .state]|join(","))"' \
    > "$STATE/prs.now" 2>/dev/null || cp "$STATE/prs.prev" "$STATE/prs.now" 2>/dev/null || : > "$STATE/prs.now"
  if [ -f "$STATE/prs.prev" ]; then
    while read -r line; do [ -n "$line" ] && { echo "PR-CHANGED $line"; fired=1; }; done \
      < <(comm -13 <(sort "$STATE/prs.prev") <(sort "$STATE/prs.now"))
    while read -r line; do [ -n "$line" ] && { echo "PR-GONE $line"; fired=1; }; done \
      < <(comm -23 <(cut -d' ' -f1,2 "$STATE/prs.prev" | sort) <(cut -d' ' -f1,2 "$STATE/prs.now" | sort))
  fi
  cp "$STATE/prs.now" "$STATE/prs.prev"

  # --- sessions
  cur=$(slots | tr '\n' ' ')
  if [ "$cur" != "$prev_sessions" ] && [ -n "$prev_sessions$cur" ]; then
    [ -n "$prev_sessions" ] && { echo "SESSIONS-CHANGED was[$prev_sessions] now[$cur]"; fired=1; }
  fi
  prev_sessions=$cur

  for s in $cur; do
    wt="$(resolve_wt "$s")"

    # --- reply files
    if [ -n "$wt" ]; then
      f="$wt/.orchestrator-reply.md"
      if [ -f "$f" ]; then
        m=$(stat -c %Y "$f")
        if [ -n "${reply_mtime[$s]:-}" ] && [ "$m" != "${reply_mtime[$s]}" ]; then
          echo "REPLY-CHANGED $s: $(grep -E '^##+ ' "$f" | tail -1)"; fired=1
        fi
        reply_mtime[$s]=$m
      fi

      # --- attribution trailer on the branch head: a slot that followed the
      # harness's own reminder rather than the owner's rule is caught here,
      # before the pull request is green rather than at merge.
      sha=$(git -C "$wt" rev-parse HEAD 2>/dev/null || true)
      if [ -n "$sha" ] && [ "$sha" != "${head_sha[$s]:-}" ]; then
        msg=$(git -C "$wt" log --format=%B -1 HEAD 2>/dev/null || true)
        trailer_in_message "$msg" && { echo "TRAILER $s $sha"; fired=1; }
        head_sha[$s]=$sha
      fi
    fi

    # --- pane: quota banner, and an idle prompt
    pane=$(tmux capture-pane -p -t "gm-$s" 2>/dev/null || true)
    if grep -q "hit your weekly limit" <<<"$pane"; then echo "QUOTA-HIT $s"; fired=1; fi
    read -r event ic ps < <(classify_pane "$pane" "${idle_count[$s]:-0}" "${prompt_seen[$s]:-0}")
    idle_count[$s]=$ic
    prompt_seen[$s]=$ps
    case "$event" in
      PROMPT) echo "PROMPT $s"; fired=1 ;;
      IDLE)   echo "IDLE $s"; fired=1 ;;
    esac
  done

  # --- heartbeat
  now=$(date +%s)
  if [ "$fired" -eq 1 ]; then last_event=$now
  elif [ $((now - last_event)) -ge "$HEARTBEAT" ]; then
    echo "HEARTBEAT $(date +%H:%M) slots[$cur]"; last_event=$now
  fi

  sleep "$POLL"
done
}

# Sourceable for `watch_test.sh` (`resolve_wt`), and still a plain script for
# everyone else — `main` only runs when this file is executed, not sourced.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
