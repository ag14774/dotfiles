#!/usr/bin/env bash
# Run a Helix buffer in a floating zellij pane without saving it in the project.
set -euo pipefail

view() {
  local language=$1 source=$2 workspace=$3 status=0

  # Read the buffer, then delete it before running: if Zellij restores this pane
  # after a crash, the rerun finds nothing to execute.
  if [ ! -f "$source" ]; then
    printf 'run-buffer: the buffer copy is gone; nothing to run.\n\n[press Enter to close]'
    read -r _ || true
    return 0
  fi
  exec 3<"$source"
  rm -rf "$(dirname "$source")"
  cd "$workspace"

  printf 'Running %s in %s\n\n' "$language" "$workspace"
  case "$language" in
    python)
      if command -v uv >/dev/null 2>&1; then
        PYTHONPATH="$workspace${PYTHONPATH:+:$PYTHONPATH}" uv run python - <&3 || status=$?
      elif [ -x "$workspace/.venv/bin/python" ]; then
        PYTHONPATH="$workspace${PYTHONPATH:+:$PYTHONPATH}" \
          "$workspace/.venv/bin/python" - <&3 || status=$?
      elif command -v python3 >/dev/null 2>&1; then
        PYTHONPATH="$workspace${PYTHONPATH:+:$PYTHONPATH}" python3 - <&3 || status=$?
      else
        printf 'run-buffer: no Python interpreter found.\n' >&2
        status=127
      fi
      ;;
    bash)
      bash -s -- <&3 || status=$?
      ;;
    javascript)
      if command -v node >/dev/null 2>&1; then
        node - <&3 || status=$?
      else
        printf 'run-buffer: node was not found.\n' >&2
        status=127
      fi
      ;;
    *)
      printf "run-buffer: unsupported Helix language '%s'.\n" "$language" >&2
      status=2
      ;;
  esac

  printf '\n[process exited %s; press Enter to close]' "$status"
  read -r _ || true
}

if [ "${1:-}" = "--view" ]; then
  view "$2" "$3" "$4"
  exit 0
fi

language=${1:?usage: run-buffer.sh <helix-language>}
workspace=$PWD
temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/helix-run.XXXXXX")
source=$temp_dir/source
cat >"$source"

if ! zellij run --floating --close-on-exit --width 90% --height 90% \
  --name "run: $language" --cwd "$workspace" -- \
  bash "$0" --view "$language" "$source" "$workspace" >/dev/null 2>&1; then
  rm -rf "$temp_dir"
  printf 'run-buffer: could not open a zellij pane.\n' >&2
  exit 1
fi
