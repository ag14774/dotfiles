# shell/cheatsheet.zsh, sourced from the dotfiles checkout by the ~/.zshrc block.
# `mdview`          -> preview this directory's README in the browser, with images.
# `mdview FILE`     -> preview any Markdown file in the browser.
# `cheat`           -> render CHEATSHEET.md as markdown in a scrollable pager (glow).
# `cheat FILE`      -> render any other markdown file the same way.
# `cheat --pretty`  -> render to Catppuccin-styled HTML and open in the browser
#                      (real fonts/sizes; needs pandoc). `cheat --pretty FILE` works too.
# glow gives proper markdown (headings, tables, colors); press q to quit the pager.

# The checkout this file is sourced from (~/dotfiles, or ~/dotfiles/main after
# wtconvert).
typeset -g _CHEATSHEET_ROOT=${${(%):-%x}:A:h:h}

mdview() {
	bash "$_CHEATSHEET_ROOT/shell/markdown-preview.sh" "$@"
}

cheat() {
	if [ "$1" = "--pretty" ]; then
		bash "$_CHEATSHEET_ROOT/shell/markdown-preview.sh" "${2:-$_CHEATSHEET_ROOT/CHEATSHEET.md}"
		return
	fi
	local f="${1:-$_CHEATSHEET_ROOT/CHEATSHEET.md}"
	command -v glow >/dev/null 2>&1 && { glow -p -w 120 -s "$HOME/.config/glow/catppuccin-mocha.json" "$f"; return; }
	"${PAGER:-less}" "$f"
}
