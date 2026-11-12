#!/usr/bin/env bash
# Install the V2 channel without exposing a partially downloaded binary.
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$HOME/.opencode/bin/opencode"
CONFIG="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/opencode"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"

for tool in curl jq uv; do
  command -v "$tool" >/dev/null || {
    echo "OpenCode installation requires $tool." >&2
    exit 1
  }
done

# Package-managed binaries must not be replaced behind their manager's back.
if command -v brew >/dev/null && brew list --formula 2>/dev/null | grep -Eq '(^|/)opencode(@.*)?$'; then
  echo "Remove the Homebrew OpenCode formula with brew uninstall <formula> before installing V2." >&2
  exit 1
fi
if command -v pacman >/dev/null && pacman -Qq 2>/dev/null | grep -Eq '^opencode(-bin)?$'; then
  echo "Remove the Pacman OpenCode package before installing V2." >&2
  exit 1
fi
if command -v dpkg-query >/dev/null && dpkg-query -W -f='${Status}' opencode 2>/dev/null | grep -q 'install ok installed'; then
  echo "Remove the APT OpenCode package before installing V2." >&2
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
curl -fsSL https://raw.githubusercontent.com/anomalyco/opencode/v2/packages/tui/src/config/v1/keybind.ts -o "$TMP/keybind.ts"

# Resolve migration dependencies before modifying the user's installation.
MIGRATE=(uv run --no-project --with json5 --with jsonschema python "$DOTFILES/install/opencode-migrate.py")
"${MIGRATE[@]}" prepare "$CONFIG" "$STATE" "$TMP/cli-schema.json" "$TMP/keybind.ts" "$TMP/cli.json"

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

# Always retain the pre-change binary/settings. SQLite's backup API includes WAL
# transactions, even when a V1 session is still open. No server is started here.
if [ "$CURRENT" != "$VERSION" ] || [ -f "$TMP/cli.json" ]; then
  "${MIGRATE[@]}" backup "$CONFIG" "$STATE" "$DATA" "$BIN"
fi
if [ -f "$TMP/cli.json" ]; then
  mkdir -p "$CONFIG"
  # Preparation emits an existing file only to repair plugin entries (the
  # bundled BTW reference, the ADE plugin's old app part).
  cp "$TMP/cli.json" "$CONFIG/cli.json.dotfiles-new"
  chmod 600 "$CONFIG/cli.json.dotfiles-new"
  mv "$CONFIG/cli.json.dotfiles-new" "$CONFIG/cli.json"
fi
if [ "$CURRENT" != "$VERSION" ]; then
  mkdir -p "$HOME/.opencode/bin"
  cp "$STAGED" "$BIN.new"
  chmod 755 "$BIN.new"
  mv "$BIN.new" "$BIN"
fi
# 2.0.24 imports Azure resourceName as request-body metadata (upstream #53443).
# Starting the service imports V1 credentials; repair only the affected Azure key.
if [ "$VERSION" = "2.0.24" ]; then
  PATH="$HOME/.opencode/bin:$PATH" uv run --no-project python "$DOTFILES/install/opencode-credentials.py"
fi
echo "==> OpenCode $VERSION ready. Restart OpenCode to use V2."
echo "    V1 server config, credentials, definitions and tui.json are retained."
echo "    V2 migrates session data on first startup; OpenCode LSP tools are no longer available."
