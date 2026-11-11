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
    echo "The pinned upstream Helix .deb requires amd64; Debian arm64 is not supported." >&2
    exit 1
    ;;
  *)
    echo "Unsupported Debian architecture: $(dpkg --print-architecture)" >&2
    exit 1
    ;;
esac

if ((EUID == 0)); then
  AS_ROOT=()
else
  command -v sudo >/dev/null 2>&1 || {
    echo "sudo is required to install APT packages." >&2
    exit 1
  }
  AS_ROOT=(sudo)
fi
APT=("${AS_ROOT[@]}" apt-get)

"${APT[@]}" update
"${APT[@]}" install -y "${PACKAGES[@]}"

# Node.js from NodeSource: Debian 13's own nodejs is Node 20, end-of-life since
# April 2026 and too old to run TypeScript files directly (Node 22.18+), which
# the ADE's `ade` command needs. Keep NODE_MAJOR on a current LTS release.
NODE_MAJOR=26
NODESOURCE_KEY=/etc/apt/keyrings/nodesource.asc
echo "==> Node.js $NODE_MAJOR (NodeSource)"
"${AS_ROOT[@]}" install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
  "${AS_ROOT[@]}" tee "$NODESOURCE_KEY" >/dev/null
printf 'deb [signed-by=%s] https://deb.nodesource.com/node_%s.x nodistro main\n' "$NODESOURCE_KEY" "$NODE_MAJOR" |
  "${AS_ROOT[@]}" tee /etc/apt/sources.list.d/nodesource.list >/dev/null
"${APT[@]}" update
"${APT[@]}" install -y nodejs

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

# Debian's Helix is too old for the shared config. This version is hardcoded:
# manually bump the release, package version, and SHA256 when upgrading Helix.
HELIX_VERSION="25.07.1"
HELIX_DEB_VERSION="25.7.1-1"
HELIX_SHA256="c9ff7ee3113f039c21c3ff31e8e2b71d1cc51a2c3e6c39face36e3cf25fe8788"
HELIX_PACKAGE="$TMP_DIR/helix_${HELIX_DEB_VERSION}_${DEB_ARCH}.deb"

echo "==> Helix $HELIX_VERSION (pinned upstream package; manually updated)"
curl -fsSL "https://github.com/helix-editor/helix/releases/download/$HELIX_VERSION/helix_${HELIX_DEB_VERSION}_${DEB_ARCH}.deb" \
  -o "$HELIX_PACKAGE"
printf '%s  %s\n' "$HELIX_SHA256" "$HELIX_PACKAGE" | sha256sum -c -
# Both packages own /usr/bin/hx; remove the distro package in the same transaction.
"${APT[@]}" install -y "$HELIX_PACKAGE" hx-

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

echo "==> tuicr (official release)"
download_release_asset "agavra/tuicr" \
  "^tuicr-[0-9.]+-$RELEASE_ARCH-unknown-linux-musl\\.tar\\.gz$" "$TMP_DIR/tuicr.tar.gz"
tar -xzf "$TMP_DIR/tuicr.tar.gz" -C "$HOME/.local/bin" tuicr

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
