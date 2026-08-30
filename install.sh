#!/usr/bin/env bash
# Dotfiles installer (macOS/Homebrew or Linux/APT/Pacman, with zsh). Safe to re-run.
#
#   git clone <repo> ~/dotfiles && ~/dotfiles/install.sh && exec zsh
#
# It installs platform packages + developer tools/language servers and the Yazi flavor,
# symlinks config/ into ~/.config via stow, sets up zoxide (replacing autojump),
# maintains small idempotent blocks at the start and end of ~/.zshrc. (zjstatus
# is loaded by dev.kdl directly from its release URL.)
# Shell expressions written into ~/.zshrc must remain literal until zsh loads it.
# shellcheck disable=SC2016
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZSHRC="$HOME/.zshrc"
B="# >>> dotfiles (helix/yazi/zellij) >>>"
E="# <<< dotfiles (helix/yazi/zellij) <<<"
ZB="# >>> dotfiles (zellij autostart) >>>"
ZE="# <<< dotfiles (zellij autostart) <<<"

if ((EUID == 0)) && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  echo "Run this installer as your normal user, without sudo." >&2
  exit 1
fi

INSTALL_USER="$(id -un)"
OS_NAME="$(uname -s)"

case "$OS_NAME" in
  Darwin)
    PACKAGE_INSTALLER="brew"
    ;;
  Linux)
    OS_ID=""
    if [ -r /etc/os-release ]; then
      # shellcheck source=/dev/null
      OS_ID="$(. /etc/os-release && printf '%s' "${ID:-}")"
    fi
    if [ "$OS_ID" = "debian" ] && command -v apt-get >/dev/null 2>&1; then
      PACKAGE_INSTALLER="apt"
    elif command -v pacman >/dev/null 2>&1; then
      PACKAGE_INSTALLER="pacman"
    else
      echo "Unsupported Linux distribution: Debian/APT or Pacman is required." >&2
      exit 1
    fi
    ;;
  *)
    echo "Unsupported operating system: $OS_NAME" >&2
    exit 1
    ;;
esac

bash "$DOTFILES/install/$PACKAGE_INSTALLER.sh"

ZSH_BIN="$(command -v zsh || true)"
if [ -r /etc/shells ]; then
  while IFS= read -r shell; do
    if [[ $shell == */zsh && -x $shell ]]; then
      ZSH_BIN="$shell"
      break
    fi
  done </etc/shells
fi
[ -n "$ZSH_BIN" ] || {
  echo "zsh was not installed by the platform backend." >&2
  exit 1
}

LOGIN_SHELL="${SHELL:-}"
case "$OS_NAME" in
  Darwin)
    if SHELL_RECORD="$(dscl . -read "/Users/$INSTALL_USER" UserShell 2>/dev/null)"; then
      LOGIN_SHELL="${SHELL_RECORD#*: }"
    fi
    ;;
  Linux)
    if PASSWD_ENTRY="$(getent passwd "$INSTALL_USER" 2>/dev/null)"; then
      LOGIN_SHELL="${PASSWD_ENTRY##*:}"
    fi
    ;;
esac

if [[ $LOGIN_SHELL != */zsh ]]; then
  echo "==> Default login shell (zsh)"
  command -v chsh >/dev/null 2>&1 || {
    echo "chsh is required to set zsh as the default shell." >&2
    exit 1
  }
  chsh -s "$ZSH_BIN" "$INSTALL_USER"
fi

command -v curl >/dev/null 2>&1 || {
  echo "curl is required to install uv, OpenCode, and rustup." >&2
  exit 1
}

echo "==> uv (official installer)"
if [ -x "$HOME/.local/bin/uv" ]; then
  UV_NO_MODIFY_PATH=1 "$HOME/.local/bin/uv" self update >/dev/null
else
  curl -LsSf https://astral.sh/uv/install.sh | UV_NO_MODIFY_PATH=1 sh
fi
export PATH="$HOME/.local/bin:$PATH"

echo "==> pyright (uv tool)"
uv tool install --upgrade pyright >/dev/null

if [ "$PACKAGE_INSTALLER" = "apt" ]; then
  echo "==> ruff (uv tool)"
  uv tool install --upgrade ruff >/dev/null
fi

echo "==> JS-based language servers (npm -g)"
# core-js's postinstall only prints its funding notice; allow that script explicitly.
npm install --global --prefix "$HOME/.local" --allow-scripts=core-js \
  bash-language-server yaml-language-server vscode-langservers-extracted >/dev/null

echo "==> OpenCode (official installer)"
export PATH="$HOME/.opencode/bin:$PATH"
curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path

echo "==> Rust toolchain (rustup)"
if [ ! -x "$HOME/.cargo/bin/rustup" ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
fi
export PATH="$HOME/.cargo/bin:$PATH"
"$HOME/.cargo/bin/rustup" update stable >/dev/null
"$HOME/.cargo/bin/rustup" default stable >/dev/null

echo "==> Cargo-based language servers"
cargo install jinja-lsp >/dev/null

echo "==> Symlink config/ into ~/.config (stow)"
mkdir -p "$HOME/.config"
stow --no-folding -d "$DOTFILES" -t "$HOME" config

echo "==> Yazi flavor (catppuccin-mocha, from package.toml)"
ya pkg install >/dev/null

echo "==> zoxide: seed from autojump history (one-time, if present)"
if [ "$(uname -s)" = "Darwin" ]; then
  AUTOJUMP_HISTORY="$HOME/Library/autojump/autojump.txt"
else
  AUTOJUMP_HISTORY="${XDG_DATA_HOME:-$HOME/.local/share}/autojump/autojump.txt"
fi
if [ -f "$AUTOJUMP_HISTORY" ] &&
  [ "$(zoxide query -l 2>/dev/null | wc -l | tr -d ' ')" = "0" ]; then
  if ! zoxide import autojump <"$AUTOJUMP_HISTORY"; then
    echo "Warning: could not import autojump history from $AUTOJUMP_HISTORY" >&2
  fi
fi

echo "==> secrets.zsh (from example, if missing)"
mkdir -p "$HOME/.config/zsh"
[ -f "$HOME/.config/zsh/secrets.zsh" ] || cp "$DOTFILES/secrets.zsh.example" "$HOME/.config/zsh/secrets.zsh"

echo "==> ~/.zshrc managed block"
if [ -f "$ZSHRC" ]; then
  cp "$ZSHRC" "$ZSHRC.dotfiles-bak"
fi
{
  printf '%s\n' "$ZB"
  printf 'export SHELL="%s"\n' "$ZSH_BIN"
  printf 'if [[ -z "${ZELLIJ:-}" && "${ZELLIJ_AUTO_START:-true}" == true ]] && command -v zellij >/dev/null 2>&1; then\n'
  printf '  exec zellij\n'
  printf 'fi\n'
  printf '%s\n\n' "$ZE"
  if [ -f "$ZSHRC" ]; then
    # Strip previous managed blocks before rebuilding them in their proper positions.
    awk -v b="$B" -v e="$E" -v zb="$ZB" -v ze="$ZE" \
      '$0==b || $0==zb{s=1; next}
			 s{if ($0==e || $0==ze) s=0; next}
			 {line[++n]=$0}
			 END {
				first=1
				while (first<=n && line[first] ~ /^[[:space:]]*$/) first++
				while (n>=first && line[n] ~ /^[[:space:]]*$/) n--
				for (i=first; i<=n; i++) print line[i]
			 }' "$ZSHRC"
  fi
  printf '\n'
  printf '%s\n' "$B"
  printf 'typeset -U path PATH\n'
  printf 'export PATH="$HOME/.local/bin:$HOME/.opencode/bin:$HOME/.cargo/bin:$PATH"\n'
  printf 'if command -v hx >/dev/null 2>&1; then\n'
  printf '  export EDITOR=hx\n'
  printf 'else\n'
  printf '  export EDITOR=helix\n'
  printf 'fi\n'
  printf 'export VISUAL="$EDITOR"\n'
  printf 'source "%s/shell/init.zsh"\n' "$DOTFILES"        # zsh framework: options, compinit, keybinds, starship, plugins (replaces oh-my-zsh)
  printf 'source "%s/shell/completions.zsh"\n' "$DOTFILES" # CLI completions that need compinit (opencode, ...)
  printf 'eval "$(zoxide init zsh --cmd j)"\n'             # zoxide replaces autojump (j / ji); also feeds yazi's z
  printf 'source "$HOME/.config/fzf/fzf.env"\n'            # fzf file list: respect .gitignore (Alt-g toggles); also sourced by yazi-picker.sh
  printf '[ -f "$HOME/.config/zsh/secrets.zsh" ] && source "$HOME/.config/zsh/secrets.zsh"\n'
  printf '[ -f "$HOME/.config/zsh/local.zsh" ] && source "$HOME/.config/zsh/local.zsh"\n' # machine-local, gitignored (e.g. work fns, tool completions); after compinit
  printf 'source "%s/shell/aliases.zsh"\n' "$DOTFILES"                                    # rm/cp/mv -i (we don't load omz's common-aliases plugin)
  printf 'source "%s/shell/worktree.zsh"\n' "$DOTFILES"
  printf 'source "%s/shell/ocreload.zsh"\n' "$DOTFILES"
  printf 'source "%s/shell/cheatsheet.zsh"\n' "$DOTFILES"
  printf 'source "%s/shell/git.zsh"\n' "$DOTFILES" # ggpush/ggpull + gcai (we don't load omz's git plugin)
  printf 'source "%s/shell/reset.zsh"\n' "$DOTFILES"
  printf 'dotfiles_load_syntax_highlighting\n' # MUST stay last: highlighting wraps every widget/keybinding defined above
  printf '%s\n' "$E"
} >"$ZSHRC.new"
mv "$ZSHRC.new" "$ZSHRC"

echo "==> Done. Run: exec zsh"
echo
echo "One-time: enable the zjstatus top bar (grant its plugin permission)."
echo "  Inside a zellij session, run this once, press 'y' to grant, then close the pane:"
echo "      zellij plugin -f -- \"https://github.com/dj95/zjstatus/releases/download/v0.23.0/zjstatus.wasm\""
