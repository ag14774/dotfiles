# ocreload.zsh
# ocreload: restart this tab's OpenCode in the current folder. The shared
# OpenCode service outlives the pane, so its config is reloaded first, once it
# has let go of the folders it served that are gone (removed worktrees): its
# reload fails on them.

ocreload() {
  command ade forget-gone >/dev/null
  command opencode reload || return
  command ade restart-agent "$PWD"
}
