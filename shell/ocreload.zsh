# ocreload.plugin.zsh
# Reload opencode in the CURRENT zellij TAB, pointed at the CURRENT directory.
#
# Usage: in the LEFT shell pane, `cd` into your project, then run:  ocreload
#
# It locates THIS tab's opencode pane by ID (current-tab-info + `list-panes --all`,
# matching TAB_ID + the "opencode" command -- so it never touches another tab or the
# shell), replaces it IN PLACE (keeps the 30% slot) with a fresh opencode in $PWD,
# then returns focus here. If this tab has no opencode pane, it opens one to the right.
ocreload() {
  [[ -z "$ZELLIJ" ]] && { echo "ocreload: not inside a zellij session" >&2; return 1; }
  local dir="$PWD"
  local back="terminal_${ZELLIJ_PANE_ID}"
  local tab id
  tab=$(zellij action current-tab-info 2>/dev/null | awk '/^id:/{print $2}')
  id=$(zellij action list-panes --all 2>/dev/null | awk -v t="$tab" 'NR>1 && $1==t { isoc=0; pid=""; for(i=1;i<=NF;i++){ if($i=="opencode") isoc=1; if($i ~ /^(terminal|plugin)_[0-9]+$/) pid=$i } if(isoc && pid!=""){ print pid; exit } }')
  if [[ -n "$id" ]]; then
    zellij action focus-pane-id "$id"
    zellij action new-pane --in-place --close-replaced-pane --close-on-exit --cwd "$dir" -- zsh -i -c opencode
  else
    zellij action new-pane --direction right --close-on-exit --cwd "$dir" -- zsh -i -c opencode
  fi
  zellij action focus-pane-id "$back"
}
