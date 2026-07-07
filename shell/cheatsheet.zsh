# ~/dotfiles/shell/cheatsheet.zsh
# `cheat`       -> render ~/dotfiles/CHEATSHEET.md as markdown in a scrollable pager.
# `cheat FILE`  -> render any other markdown file the same way.
# glow gives proper markdown (headings, tables, colors); press q to quit.
# Falls back to $PAGER/less if glow isn't installed yet.
cheat() {
	local f="${1:-$HOME/dotfiles/CHEATSHEET.md}"
	command -v glow >/dev/null 2>&1 && { glow -p "$f"; return; }
	"${PAGER:-less}" "$f"
}
