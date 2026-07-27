#!/usr/bin/env bash
set -euo pipefail

PACKAGES=(
  # Shell and core terminal IDE stack
  zsh
  starship                # prompt (we roll our own zsh setup, not oh-my-zsh)
  zsh-autosuggestions     # fish-style suggestions from history
  zsh-syntax-highlighting # command-line syntax colouring
  ghostty
  helix
  yazi
  zellij

  # Yazi preview and helper dependencies
  ffmpeg
  7zip
  poppler
  imagemagick
  resvg
  chafa
  jq
  fd
  ripgrep
  fzf
  zoxide

  # Language servers and formatters
  ruff
  taplo-cli
  marksman
  shellcheck
  shfmt
  nodejs
  npm

  # Tooling
  uv
  stow
  git-delta
  glow
  pandoc-cli
  xdg-utils
)

echo "==> Pacman packages"
command -v pacman >/dev/null 2>&1 || {
  echo "Pacman is required for this Linux installer." >&2
  exit 1
}

if ((EUID == 0)); then
  pacman -S --needed "${PACKAGES[@]}"
else
  command -v sudo >/dev/null 2>&1 || {
    echo "sudo is required to install Pacman packages." >&2
    exit 1
  }
  sudo pacman -S --needed "${PACKAGES[@]}"
fi
