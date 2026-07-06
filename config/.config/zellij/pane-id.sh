#!/usr/bin/env bash
# ~/.config/zellij/pane-id.sh
# Resolve a zellij pane by its (sticky) NAME to a --pane-id token.
#   pane-id.sh <name> [tab_id]   ->  prints "terminal_<N>" (first match) or nothing
#
# Pane names are set via layout `name=`, `new-pane -n`, or `rename-pane`, and are
# STICKY: once a pane is named, zellij ignores the app's OSC title changes, so the
# lookup stays reliable even when hx/opencode set their own titles.
set -u
name="${1:-}"
tab="${2:-}"
[ -n "$name" ] || exit 0
zellij action list-panes --json 2>/dev/null | jq -r --arg n "$name" --arg t "$tab" '
  .[]
  | select(.is_plugin == false and .title == $n)
  | select($t == "" or ((.tab_id | tostring) == $t))
  | "terminal_\(.id)"
' | head -n1
