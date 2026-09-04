#!/usr/bin/env bash
set -euo pipefail

PACKAGES=(
  # Native build toolchain (required by cargo install)
  build-essential
  pkg-config

  # Shell and core terminal IDE stack available from Debian
  zsh
  starship
  zsh-autosuggestions
  zsh-syntax-highlighting
  hx

  # Yazi preview and helper dependencies
  ffmpeg
  7zip
  poppler-utils
  imagemagick
  librsvg2-bin
  chafa
  jq
  fd-find
  ripgrep
  fzf
  zoxide
  file

  # Language servers and formatters
  shellcheck
  shfmt
  nodejs

  # Tooling
  curl
  stow
  git-delta
  gh
  glow
  pandoc
  xdg-utils
  xz-utils
)

echo "==> APT packages"
command -v apt-get >/dev/null 2>&1 || {
  echo "APT is required for the Debian installer." >&2
  exit 1
}

# shellcheck source=/dev/null
. /etc/os-release
if [ "${ID:-}" != "debian" ]; then
  echo "The APT backend currently supports Debian only." >&2
  exit 1
fi
if [ "${VERSION_CODENAME:-}" != "trixie" ]; then
  echo "The APT backend currently supports Debian 13 (Trixie) only." >&2
  exit 1
fi

case "$(dpkg --print-architecture)" in
  amd64)
    DEB_ARCH="amd64"
    RELEASE_ARCH="x86_64"
    MARKSMAN_ARCH="x64"
    ;;
  arm64)
    DEB_ARCH="arm64"
    RELEASE_ARCH="aarch64"
    MARKSMAN_ARCH="arm64"
    ;;
  *)
    echo "Unsupported Debian architecture: $(dpkg --print-architecture)" >&2
    exit 1
    ;;
esac

if ((EUID == 0)); then
  APT=(apt-get)
else
  command -v sudo >/dev/null 2>&1 || {
    echo "sudo is required to install APT packages." >&2
    exit 1
  }
  APT=(sudo apt-get)
fi

"${APT[@]}" update
"${APT[@]}" install -y "${PACKAGES[@]}"

# NodeSource's nodejs package includes npm and conflicts with Debian's separate
# package. Install npm only when the selected nodejs package did not provide it.
if ! command -v npm >/dev/null 2>&1; then
  "${APT[@]}" install -y npm
fi

mkdir -p "$HOME/.local/bin"
if [ ! -e "$HOME/.local/bin/fd" ] && [ ! -L "$HOME/.local/bin/fd" ]; then
  ln -s "$(command -v fdfind)" "$HOME/.local/bin/fd"
fi

TMP_DIR="$(mktemp -d)"
chmod 0755 "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

download_release_asset() {
  local repo="$1"
  local pattern="$2"
  local output="$3"
  local release asset url digest expected

  release="$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest")"
  asset="$(printf '%s' "$release" | jq -cer --arg pattern "$pattern" '
    [.assets[] | select(.name | test($pattern))] |
    if length == 1 then .[0] else error("expected exactly one matching release asset") end
  ')"
  url="$(printf '%s' "$asset" | jq -r .browser_download_url)"
  digest="$(printf '%s' "$asset" | jq -r '.digest // empty')"

  curl -fsSL "$url" -o "$output"
  if [[ $digest == sha256:* ]]; then
    expected="${digest#sha256:}"
    printf '%s  %s\n' "$expected" "$output" | sha256sum -c - >/dev/null
  fi
}

install_release_deb() {
  local name="$1"
  local repo="$2"
  local pattern="$3"
  local package="$TMP_DIR/$name.deb"

  echo "==> $name (release package)"
  download_release_asset "$repo" "$pattern" "$package"
  "${APT[@]}" install -y "$package"
}

# These tools are not in Debian 13. Use upstream packages where available.
install_release_deb "Yazi" "sxyazi/yazi" \
  "^yazi-$RELEASE_ARCH-unknown-linux-gnu\\.deb$"

install_release_deb "Ghostty (community package)" "mkasberg/ghostty-ubuntu" \
  "^ghostty_[^/]+_${DEB_ARCH}_${VERSION_CODENAME}\\.deb$"

echo "==> Zellij (official release)"
download_release_asset "zellij-org/zellij" \
  "^zellij-$RELEASE_ARCH-unknown-linux-musl\\.tar\\.gz$" "$TMP_DIR/zellij.tar.gz"
tar -xzf "$TMP_DIR/zellij.tar.gz" -C "$HOME/.local/bin" zellij

echo "==> Taplo (official release)"
download_release_asset "tamasfe/taplo" \
  "^taplo-linux-$RELEASE_ARCH\\.gz$" "$TMP_DIR/taplo.gz"
gzip -dc "$TMP_DIR/taplo.gz" >"$TMP_DIR/taplo"
chmod +x "$TMP_DIR/taplo"
mv "$TMP_DIR/taplo" "$HOME/.local/bin/taplo"

echo "==> Marksman (official release)"
download_release_asset "artempyanykh/marksman" \
  "^marksman-linux-$MARKSMAN_ARCH$" "$TMP_DIR/marksman"
chmod +x "$TMP_DIR/marksman"
mv "$TMP_DIR/marksman" "$HOME/.local/bin/marksman"
