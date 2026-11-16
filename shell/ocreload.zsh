# ocreload.zsh
# ocreload [DIR]: a fresh OpenCode, on a new conversation, in this folder (or
# DIR), in place of this tab's. The old one's conversation goes on.

ocreload() { command ade restart-agent "$@"; }
