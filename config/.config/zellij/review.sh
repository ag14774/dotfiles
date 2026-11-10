#!/usr/bin/env bash
# ~/.config/zellij/review.sh
#
# Alt-v runs this in a floating pane: a tuicr review of everything this tab's
# worktree changed since it left the remote's default branch (origin/HEAD, the
# base `wt` uses), committed or not. In a `wtreview` worktree, that is the PR
# plus your own edits.
#
# In tuicr, `c` comments on a line, `e` opens the file in this tab's editor pane
# (Alt-v brings the review back), and `y` ends the review and pastes your
# comments into this tab's OpenCode, ready to send. `:q` quits without sending.
#
#   review.sh           what Alt-v runs
#   review.sh --scope   print tuicr's scope arguments for this directory
set -u

# This checkout's scripts (stowed to ~/.local/bin), found through the stow
# symlink, like yazi-picker.sh.
BIN="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../.local/bin"

# Act on this pane's session by name: given a session name that no longer
# exists, plain `zellij action` acts on whichever session is running.
zj() { zellij --session "$ZELLIJ_SESSION_NAME" action "$@"; }
pause() {
  printf '%s\n\nPress any key to close.' "$1"
  read -rsn1 _ || true
}

# tuicr's scope arguments for the repository at $1, one per line: -r BASE..HEAD
# for the commits since its merge base with origin/HEAD, -w for uncommitted
# changes (new files included). Nothing when there is nothing to review.
scope() {
  local head base
  head=$(git -C "$1" rev-parse --verify --quiet HEAD)
  base=$(git -C "$1" merge-base origin/HEAD HEAD 2>/dev/null)
  if [ -n "$base" ] && [ "$base" != "$head" ]; then printf '%s\n' -r "$base..HEAD"; fi
  if [ -n "$(git -C "$1" status --porcelain)" ]; then printf '%s\n' -w; fi
}

if [ "${1:-}" = --scope ]; then
  top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1
  scope "$top"
  exit
fi

dir=$PWD
panes=""
if [ -n "${ZELLIJ_SESSION_NAME:-}" ] && [ -n "${ZELLIJ_PANE_ID:-}" ]; then
  panes=$(zj list-panes --json 2>/dev/null)
fi
if [ -n "$panes" ]; then
  # This pane's tab, without plugins.
  tab_panes() {
    jq --arg me "$ZELLIJ_PANE_ID" '
      map(select(.is_plugin == false)) as $panes
      | ($panes | map(select((.id | tostring) == $me))[0].tab_id) as $tab
      | $panes | map(select(.tab_id == $tab))' <<<"$panes"
  }
  # One review per tab: if this tab already has one (hidden after `e`, say),
  # show it instead of starting another.
  other=$(tab_panes | jq -r --arg me "$ZELLIJ_PANE_ID" 'map(select(.title == "review"
    and (.id | tostring) != $me and ((.exited or .is_held) | not)))[0].id // empty')
  if [ -n "$other" ]; then
    zj focus-pane-id "terminal_$other"
    exit 0
  fi
  # Review the directory of the pane you were in: the tab's focused tiled pane
  # (this floating pane starts in the session's directory, not yours), else
  # its OpenCode or main pane.
  cwd=$(tab_panes | jq -r 'map(select((.is_floating | not) and .pane_cwd != null))
    | (map(select(.is_focused)) + map(select(.title == "opencode")) + map(select(.title == "main")))[0].pane_cwd // empty')
  if [ -n "$cwd" ] && [ -d "$cwd" ]; then dir=$cwd; fi
fi

top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)
[ -n "$top" ] || {
  pause "Nothing to review: $dir is not in a Git repository."
  exit 0
}

args=()
while IFS= read -r arg; do args+=("$arg"); done < <(scope "$top")
if [ "${#args[@]}" -eq 0 ]; then
  if git -C "$top" rev-parse --verify --quiet origin/HEAD >/dev/null; then
    pause "Nothing to review in $top: no commits since origin/HEAD and no uncommitted changes."
  else
    pause "Nothing to review in $top: no uncommitted changes (and no origin/HEAD to compare commits with)."
  fi
  exit 0
fi

out=$(mktemp "${TMPDIR:-/tmp}/review.XXXXXX")
trap 'rm -f "$out"' EXIT
(cd "$top" && EDITOR="$BIN/hx-open" tuicr "${args[@]}" --stdout >"$out")
[ -s "$out" ] || exit 0
if ! "$BIN/opencode-send" --text <"$out"; then
  pause "$(cat "$out")

The comments above could not be sent to this tab's OpenCode."
fi
