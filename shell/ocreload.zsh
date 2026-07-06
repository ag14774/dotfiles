# ocreload.zsh
# Reload opencode in the CURRENT zellij TAB, pointed at the CURRENT directory.
#
# Usage: in your shell pane, `cd` into your project, then run:  ocreload
#
# Locating this tab's opencode pane:
#   1. PREFER a pane NAMED "opencode" (shared pane-id.sh resolver, scoped to this
#      tab) -- matches the named layout in dev.kdl.
#   2. FALL BACK to any pane running the `opencode` command in this tab.
# It replaces that pane IN PLACE (keeping its slot, re-named "opencode") with a
# fresh opencode in $PWD, then returns focus here. If none is found, opens one right.
ocreload() {
  [[ -z "$ZELLIJ" ]] && {
    echo "ocreload: not inside a zellij session" >&2
    return 1
  }
  local dir="$PWD"
  local back="terminal_${ZELLIJ_PANE_ID}"
  local resolver="$HOME/.config/zellij/pane-id.sh"
  local tab id

  tab=$(zellij action current-tab-info 2>/dev/null | awk '/^id:/{print $2}')

  # 1) prefer a pane NAMED "opencode" in this tab
  [[ -f "$resolver" ]] && id=$(bash "$resolver" opencode "$tab" 2>/dev/null)

  # 2) fall back: any pane running the `opencode` command in this tab
  if [[ -z "$id" ]]; then
    id=$(zellij action list-panes --all 2>/dev/null | awk -v t="$tab" '
      NR>1 && $1==t {
        isoc=0; pid=""
        for (i=1; i<=NF; i++) {
          if ($i=="opencode") isoc=1
          if ($i ~ /^(terminal|plugin)_[0-9]+$/) pid=$i
        }
        if (isoc && pid!="") { print pid; exit }
      }')
  fi

  if [[ -n "$id" ]]; then
    zellij action focus-pane-id "$id"
    zellij action new-pane --in-place --close-replaced-pane --close-on-exit --name opencode --cwd "$dir" -- zsh -i -c opencode
  else
    zellij action new-pane --direction right --close-on-exit --name opencode --cwd "$dir" -- zsh -i -c opencode
  fi
  zellij action focus-pane-id "$back"
}
