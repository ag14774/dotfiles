# ocreload.zsh
# ocreload: restart this tab's OpenCode in the current folder. The shared
# OpenCode service outlives the pane, so its config is reloaded first, once it
# has let go of the folders it served that are gone (removed worktrees): its
# reload fails on them.
typeset -g _OCRELOAD_ADE=${${(%):-%x}:A:h:h}/config/.local/bin/ade

ocreload() {
  "$_OCRELOAD_ADE" forget-gone >/dev/null
  command opencode reload || return
  "$_OCRELOAD_ADE" restart-agent "$PWD"
}
