# ~/dotfiles/shell/cheatsheet.zsh
# `cheat`           -> render CHEATSHEET.md as markdown in a scrollable pager (glow).
# `cheat FILE`      -> render any other markdown file the same way.
# `cheat --pretty`  -> render to Catppuccin-styled HTML and open in the browser
#                      (real fonts/sizes; needs pandoc). `cheat --pretty FILE` works too.
# glow gives proper markdown (headings, tables, colors); press q to quit the pager.
cheat() {
	if [ "$1" = "--pretty" ]; then
		local md="${2:-$HOME/dotfiles/CHEATSHEET.md}"
		local out="${TMPDIR:-/tmp}/cheatsheet.html"
		if ! command -v pandoc >/dev/null 2>&1; then
			printf 'cheat --pretty needs pandoc (brew install pandoc)\n' >&2
			return 1
		fi
		pandoc "$md" -s --embed-resources --css "$HOME/dotfiles/CHEATSHEET.css" \
			--metadata title="Terminal IDE Cheatsheet" -o "$out" && open "$out"
		return
	fi
	local f="${1:-$HOME/dotfiles/CHEATSHEET.md}"
	command -v glow >/dev/null 2>&1 && { glow -p -w 120 -s "$HOME/.config/glow/catppuccin-mocha.json" "$f"; return; }
	"${PAGER:-less}" "$f"
}
