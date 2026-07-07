#!/usr/bin/env bash
# Dotfiles installer (macOS, zsh + oh-my-zsh). Safe to re-run.
#
#   git clone <repo> ~/dotfiles && ~/dotfiles/install.sh && exec zsh
#
# It installs Brewfile packages + language servers and the Yazi flavor, symlinks
# config/ into ~/.config via stow, sets up zoxide (replacing autojump), and
# appends a small idempotent managed block to ~/.zshrc. (zjstatus is loaded by
# dev.kdl directly from its release URL.)
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZSHRC="$HOME/.zshrc"
B="# >>> dotfiles (helix/yazi/zellij) >>>"
E="# <<< dotfiles (helix/yazi/zellij) <<<"

echo "==> Homebrew packages (brew bundle)"
command -v brew >/dev/null || {
	echo "Install Homebrew first: https://brew.sh" >&2
	exit 1
}
brew bundle --file "$DOTFILES/Brewfile"

echo "==> basedpyright (uv tool)"
uv tool install basedpyright 2>/dev/null || uv tool upgrade basedpyright 2>/dev/null || true

echo "==> JS-based language servers (npm -g)"
npm install -g bash-language-server yaml-language-server vscode-langservers-extracted >/dev/null 2>&1 || true

echo "==> Symlink config/ into ~/.config (stow)"
mkdir -p "$HOME/.config"
stow --no-folding -d "$DOTFILES" -t "$HOME" config

echo "==> Yazi flavor (catppuccin-mocha, from package.toml)"
ya pkg install >/dev/null 2>&1 || true

echo "==> zoxide: seed from autojump history (one-time, if present)"
if [ -f "$HOME/Library/autojump/autojump.txt" ] &&
	[ "$(zoxide query -l 2>/dev/null | wc -l | tr -d ' ')" = "0" ]; then
	zoxide import autojump <"$HOME/Library/autojump/autojump.txt" 2>/dev/null || true
fi

echo "==> secrets.zsh (from example, if missing)"
mkdir -p "$HOME/.config/zsh"
[ -f "$HOME/.config/zsh/secrets.zsh" ] || cp "$DOTFILES/secrets.zsh.example" "$HOME/.config/zsh/secrets.zsh"

echo "==> ~/.zshrc managed block"
if [ -f "$ZSHRC" ]; then
	cp "$ZSHRC" "$ZSHRC.dotfiles-bak"
	# strip any previous managed block (idempotent)
	awk -v b="$B" -v e="$E" '$0==b{s=1} s!=1{print} $0==e{s=0}' "$ZSHRC" >"$ZSHRC.new"
	mv "$ZSHRC.new" "$ZSHRC"
fi
{
	printf '%s\n' "$B"
	printf 'export EDITOR=hx\n'
	printf 'export VISUAL=hx\n'
	printf 'eval "$(zoxide init zsh --cmd j)"\n' # zoxide replaces autojump (j / ji); also feeds yazi's z
	printf '[ -f "$HOME/.config/zsh/secrets.zsh" ] && source "$HOME/.config/zsh/secrets.zsh"\n'
	printf 'source "%s/shell/worktree.zsh"\n' "$DOTFILES"
	printf 'source "%s/shell/ocreload.zsh"\n' "$DOTFILES"
	printf '%s\n' "$E"
} >>"$ZSHRC"

echo "==> Done. Run: exec zsh"
echo
echo "One-time: enable the zjstatus top bar (grant its plugin permission)."
echo "  Inside a zellij session, run this once, press 'y' to grant, then close the pane:"
echo "      zellij plugin -f -- \"https://github.com/dj95/zjstatus/releases/download/v0.23.0/zjstatus.wasm\""
