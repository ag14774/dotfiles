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
  rustup

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

TMP_DIR="$(mktemp -d)"
chmod 0755 "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

# Downloads from outside Debian are pinned: a version and the SHA-256 of its
# file. To upgrade one, bump both (the project's release page has the file).
NODESOURCE_KEY_SHA256="b42e0321dabdc24e892115da705cf061167eac12a317f23d329862d0aa0a271d"
HELIX_VERSION="25.07.1"
HELIX_DEB_VERSION="25.7.1-1"
HELIX_SHA256="c9ff7ee3113f039c21c3ff31e8e2b71d1cc51a2c3e6c39face36e3cf25fe8788"
YAZI_VERSION="26.9.1"
YAZI_SHA256="331d6247c0a0fd549f14cd599a928a529b8b22eded1bb1f61a518376c7621b45"
GHOSTTY_TAG="1.4.0-0-ppa2"
GHOSTTY_DEB="ghostty_1.4.0-0.ppa2_${DEB_ARCH}_${VERSION_CODENAME}.deb"
GHOSTTY_SHA256="82cae2f554a6a666ac9a79095f32d1e9f100a000aa4ba5d45cfea22e1e16c2b6"
ZELLIJ_VERSION="0.46.0"
ZELLIJ_SHA256="a8ee599eb357b6142443c91506a4ece3aa8811cb75dcf2b28d194bd66853c79d"
TUICR_VERSION="0.29.0"
TUICR_SHA256="48ba2ee347400a780756bc0c7726792a1a117b59d7920c10b0157bcf085b5128"
TAPLO_VERSION="0.10.0"
TAPLO_SHA256="8fe196b894ccf9072f98d4e1013a180306e17d244830b03986ee5e8eabeb6156"
MARKSMAN_VERSION="2026-02-08"
MARKSMAN_SHA256="be5098e8213219269c47fc0d916a66fa31ce0602ec967475c722260aabf26087"
UV_VERSION="0.13.8"
UV_INSTALLER_SHA256="4d8fa56e00f16b66feecacbd943773c61d61ab768b13856de350d86fd8740e2f"

# download URL SHA256 FILE: fails unless the file has that SHA-256.
download() {
  curl -fsSL "$1" -o "$3"
  printf '%s  %s\n' "$2" "$3" | sha256sum -c --quiet -
}
GITHUB=https://github.com

# Node.js from NodeSource: Debian 13's own nodejs is Node 20, end-of-life since
# April 2026; ade needs Node 24 or newer. Keep NODE_MAJOR on a current LTS
# release.
NODE_MAJOR=26
NODESOURCE_KEY=/etc/apt/keyrings/nodesource.asc
echo "==> Node.js $NODE_MAJOR (NodeSource)"
download https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key "$NODESOURCE_KEY_SHA256" "$TMP_DIR/nodesource.asc"
"${AS_ROOT[@]}" install -d -m 0755 /etc/apt/keyrings
"${AS_ROOT[@]}" install -m 0644 "$TMP_DIR/nodesource.asc" "$NODESOURCE_KEY"
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

# Debian's Helix is too old for the shared config. Both packages own
# /usr/bin/hx: remove the distro package in the same transaction.
echo "==> Helix $HELIX_VERSION (upstream package)"
download "$GITHUB/helix-editor/helix/releases/download/$HELIX_VERSION/helix_${HELIX_DEB_VERSION}_${DEB_ARCH}.deb" \
  "$HELIX_SHA256" "$TMP_DIR/helix.deb"
"${APT[@]}" install -y "$TMP_DIR/helix.deb" hx-

# These tools are not in Debian 13: upstream packages where there are some.
echo "==> Yazi $YAZI_VERSION (upstream package)"
download "$GITHUB/sxyazi/yazi/releases/download/v$YAZI_VERSION/yazi-$RELEASE_ARCH-unknown-linux-gnu.deb" \
  "$YAZI_SHA256" "$TMP_DIR/yazi.deb"
"${APT[@]}" install -y "$TMP_DIR/yazi.deb"

echo "==> Ghostty (the community package Ghostty's docs link to)"
download "$GITHUB/mkasberg/ghostty-ubuntu/releases/download/$GHOSTTY_TAG/$GHOSTTY_DEB" \
  "$GHOSTTY_SHA256" "$TMP_DIR/ghostty.deb"
"${APT[@]}" install -y "$TMP_DIR/ghostty.deb"

echo "==> Zellij $ZELLIJ_VERSION (upstream release)"
download "$GITHUB/zellij-org/zellij/releases/download/v$ZELLIJ_VERSION/zellij-$RELEASE_ARCH-unknown-linux-musl.tar.gz" \
  "$ZELLIJ_SHA256" "$TMP_DIR/zellij.tar.gz"
tar -xzf "$TMP_DIR/zellij.tar.gz" -C "$HOME/.local/bin" zellij

echo "==> tuicr $TUICR_VERSION (upstream release)"
download "$GITHUB/agavra/tuicr/releases/download/v$TUICR_VERSION/tuicr-$TUICR_VERSION-$RELEASE_ARCH-unknown-linux-musl.tar.gz" \
  "$TUICR_SHA256" "$TMP_DIR/tuicr.tar.gz"
tar -xzf "$TMP_DIR/tuicr.tar.gz" -C "$HOME/.local/bin" tuicr

echo "==> Taplo $TAPLO_VERSION (upstream release)"
download "$GITHUB/tamasfe/taplo/releases/download/$TAPLO_VERSION/taplo-linux-$RELEASE_ARCH.gz" \
  "$TAPLO_SHA256" "$TMP_DIR/taplo.gz"
gzip -dc "$TMP_DIR/taplo.gz" >"$TMP_DIR/taplo"
chmod +x "$TMP_DIR/taplo"
mv "$TMP_DIR/taplo" "$HOME/.local/bin/taplo"

echo "==> Marksman $MARKSMAN_VERSION (upstream release)"
download "$GITHUB/artempyanykh/marksman/releases/download/$MARKSMAN_VERSION/marksman-linux-$MARKSMAN_ARCH" \
  "$MARKSMAN_SHA256" "$TMP_DIR/marksman"
chmod +x "$TMP_DIR/marksman"
mv "$TMP_DIR/marksman" "$HOME/.local/bin/marksman"

# uv is not in Debian 13: its own installer, into ~/.local/bin.
if [ "$("$HOME/.local/bin/uv" --version 2>/dev/null | awk '{print $2}')" != "$UV_VERSION" ]; then
  echo "==> uv $UV_VERSION (upstream installer)"
  download "$GITHUB/astral-sh/uv/releases/download/$UV_VERSION/uv-installer.sh" \
    "$UV_INSTALLER_SHA256" "$TMP_DIR/uv-installer.sh"
  UV_NO_MODIFY_PATH=1 sh "$TMP_DIR/uv-installer.sh"
fi
