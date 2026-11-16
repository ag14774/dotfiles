# ocreload.zsh
# ocreload: restart this tab's OpenCode in the current folder. The shared
# OpenCode service outlives the pane, so its config is reloaded first.
typeset -g _OCRELOAD_ADE=${${(%):-%x}:A:h:h}/config/.local/bin/ade

ocreload() {
  command opencode reload || return
  "$_OCRELOAD_ADE" restart-agent "$PWD"
}
