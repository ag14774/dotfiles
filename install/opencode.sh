#!/usr/bin/env bash
# Install OpenCode 2 without exposing a partially downloaded binary, and set up
# its app settings (cli.json).
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$HOME/.opencode/bin/opencode"
CONFIG="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"

for tool in curl jq uv; do
  command -v "$tool" >/dev/null || {
    echo "OpenCode installation requires $tool." >&2
    exit 1
  }
done

# Package-managed binaries must not be replaced behind their manager's back.
if command -v brew >/dev/null && brew list --formula 2>/dev/null | grep -Eq '(^|/)opencode(@.*)?$'; then
  echo "Remove the Homebrew OpenCode formula with brew uninstall <formula> before installing OpenCode 2." >&2
  exit 1
fi
if command -v pacman >/dev/null && pacman -Qq 2>/dev/null | grep -Eq '^opencode(-bin)?$'; then
  echo "Remove the Pacman OpenCode package before installing OpenCode 2." >&2
  exit 1
fi
if command -v dpkg-query >/dev/null && dpkg-query -W -f='${Status}' opencode 2>/dev/null | grep -q 'install ok installed'; then
  echo "Remove the APT OpenCode package before installing OpenCode 2." >&2
  exit 1
fi
EXISTING="$(command -v opencode || true)"
if [ -n "$EXISTING" ] && { [ "$EXISTING" != "$BIN" ] || [ -L "$BIN" ]; }; then
  echo "OpenCode is managed outside $BIN ($EXISTING). Remove that installation first." >&2
  exit 1
fi

VERSION="${OPENCODE_VERSION:-$(curl -fsSL https://opencode.ai/update/api/latest/cli/npm | jq -er '.version')}"
VERSION="${VERSION#v}"
[[ $VERSION =~ ^2\.[0-9]+\.[0-9]+$ ]] || {
  echo "Expected an OpenCode 2 stable version, got: $VERSION" >&2
  exit 1
}
CURRENT=""
if [ -x "$BIN" ]; then
  CURRENT="$("$BIN" --version)"
  CURRENT="${CURRENT##* }"
  CURRENT="${CURRENT#v}"
fi

TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
curl -fsSL https://opencode.ai/v2/cli.json -o "$TMP/cli-schema.json"
uv run --no-project --with json5 --with jsonschema python "$DOTFILES/install/opencode-cli-config.py" \
  "$CONFIG" "$TMP/cli-schema.json" "$TMP/cli.json"

if [ "$CURRENT" != "$VERSION" ]; then
  curl --retry 3 -fsSL https://opencode.ai/v2/install -o "$TMP/install.sh"
  # The official script uses HOME for its destination; stage in isolation first.
  env HOME="$TMP" VERSION="$VERSION" bash "$TMP/install.sh" --version "$VERSION" --no-modify-path
  STAGED="$TMP/.opencode/bin/opencode"
  INSTALLED="$("$STAGED" --version)"
  [ "$INSTALLED" = "opencode v$VERSION" ] || {
    echo "Unexpected OpenCode binary version: $INSTALLED" >&2
    exit 1
  }
fi

if [ -f "$TMP/cli.json" ]; then
  mkdir -p "$CONFIG"
  cp "$TMP/cli.json" "$CONFIG/cli.json.dotfiles-new"
  chmod 600 "$CONFIG/cli.json.dotfiles-new"
  mv "$CONFIG/cli.json.dotfiles-new" "$CONFIG/cli.json"
fi
if [ "$CURRENT" != "$VERSION" ]; then
  mkdir -p "$HOME/.opencode/bin"
  cp "$STAGED" "$BIN.new"
  chmod 755 "$BIN.new"
  mv "$BIN.new" "$BIN"
  echo "==> OpenCode $VERSION installed. Restart OpenCode (opencode service restart) to use it."
else
  echo "==> OpenCode $VERSION is up to date."
fi
