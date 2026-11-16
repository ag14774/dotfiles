# ocreload.zsh
# ocreload: restart this tab's OpenCode in the current folder, after its
# service has let go of folders that are gone and reloaded its configuration.

ocreload() { command ade restart-agent --reload "$@"; }
