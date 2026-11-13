#!/usr/bin/env bash
# ~/.config/zellij/yazi-picker.sh
#
# Alt-y summons this in a floating pane. Yazi runs as a chooser; `ade open`
# routes the picked file(s) into this tab's named "editor" (Helix) pane, or
# spawns one.
#
# Debug: `touch ~/.cache/yazi-picker/DEBUG` to log to last-run.log; `rm` to silence.
set -u

# fzf's file-list config for Yazi's `z` (respect .gitignore; Alt-g toggles all>).
# Sourced here because Alt-y runs this via `bash -c` with the zellij *session*
# env, which predates ~/.zshrc's exports (zellij auto-starts before they run).
# This guarantees Yazi's fzf sees them even in a pre-existing session.
# shellcheck source=/dev/null
[ -f "$HOME/.config/fzf/fzf.env" ] && . "$HOME/.config/fzf/fzf.env"

# This checkout's ade (stowed to ~/.local/bin), found through the stow
# symlink so the picker keeps working before a new script is stowed.
ADE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../.local/bin/ade"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/yazi-picker"
mkdir -p "$CACHE"
LOG="$CACHE/last-run.log"

DEBUG=0
[ -f "$CACHE/DEBUG" ] && DEBUG=1
if [ "$DEBUG" = 1 ]; then
  : >"$LOG"
  ERRTO="$LOG"
else
  ERRTO=/dev/null
fi
log() {
  [ "$DEBUG" = 1 ] || return 0
  printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOG"
}

log "=== picker start === session=${ZELLIJ_SESSION_NAME:-<unset>}"

# The tab Alt-y was pressed in: the picker runs in a floating pane whose id is
# $ZELLIJ_PANE_ID; look it up to get our tab_id (used for the project lookup
# below; `ade open` scopes the editor lookup the same way). Empty => any tab.
TAB="$(zellij action list-panes --json 2>>"$ERRTO" | jq -r --arg me "${ZELLIJ_PANE_ID:-}" '.[]|select(.is_plugin==false and (.id|tostring)==$me)|.tab_id' | head -n1)"
log "current tab=[$TAB] (my pane_id=${ZELLIJ_PANE_ID:-<unset>})"

chooser="$(mktemp "${TMPDIR:-/tmp}/yazi-picker.XXXXXX")"
trap 'rm -f "$chooser"' EXIT

# Persist Yazi's last directory PER PROJECT so the next Alt-y reopens where you
# left off (no re-walking deep folders for a sibling file). Key the state file by
# the git root of this tab's `main` pane (fallback: the picker's own cwd), so each
# repo/worktree remembers its own last folder. --cwd-file writes it back on exit.
projdir="$(zellij action list-panes --json 2>>"$ERRTO" | jq -r --arg t "${TAB:-}" '.[]|select(.is_plugin==false and .title=="main")|select($t=="" or ((.tab_id|tostring)==$t))|.pane_cwd' | head -n1)"
[ -n "$projdir" ] && [ -d "$projdir" ] || projdir="$PWD"
projroot="$(git -C "$projdir" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$projdir")"
projkey="$(printf '%s' "$projroot" | cksum)"
projkey="${projkey%% *}"
cwdf="$CACHE/last-cwd-$projkey"
log "project=[$projroot] cwd-state=[$cwdf]"
start=""
if [ -s "$cwdf" ]; then
  d="$(cat "$cwdf")"
  [ -d "$d" ] && start="$d"
fi

yazi ${start:+"$start"} --chooser-file="$chooser" --cwd-file="$cwdf"
log "chooser: [$(cat "$chooser" 2>/dev/null)]"
[ -s "$chooser" ] || {
  log "no selection -> exit"
  exit 0
}

files=()
while IFS= read -r line || [ -n "$line" ]; do
  [ -n "$line" ] && files+=("$line")
done <"$chooser"
[ "${#files[@]}" -gt 0 ] || {
  log "empty -> exit"
  exit 0
}
log "files: ${files[*]}"

if [ "$DEBUG" = 1 ]; then
  ADE_LOG="$LOG" "$ADE" open "${files[@]}"
else
  "$ADE" open "${files[@]}"
fi
log "=== done ==="
