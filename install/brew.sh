#!/usr/bin/env bash
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Homebrew packages (brew bundle)"
command -v brew >/dev/null 2>&1 || {
  echo "Install Homebrew first: https://brew.sh" >&2
  exit 1
}

brew bundle --file "$DOTFILES/Brewfile"
