#!/usr/bin/env zsh
# Zellij reruns whatever resurrect-command.sh lets through when it restores a
# session, so only Helix and the OpenCode TUI may pass.

set -eu

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
failed=0

# Run the hook exactly as Zellij does: `sh -c` with the string from config.kdl,
# in a home directory where only this checkout's hook is installed.
hook=$(sed -n 's/^post_command_discovery_hook "\(.*\)"$/\1/p' "$ROOT/config/.config/zellij/config.kdl" \
  | sed 's/\\"/"/g')
[[ -n $hook ]] || { print -u2 "FAIL: no post_command_discovery_hook in config.kdl"; exit 1; }
mkdir -p "$TMP/home/.config/zellij"
ln -s "$ROOT/config/.config/zellij/resurrect-command.sh" "$TMP/home/.config/zellij/"
run_hook() { RESURRECT_COMMAND=$1 HOME=$2 sh -c "$hook"; }
resume="$TMP/home/.local/bin/opencode-pane --resume"

# discovered command | expected replacement (empty: plain shell)
cases=(
  "opencode|$resume"
  "opencode --continue|$resume"
  "opencode --prompt fix the flaky test|$resume"
  "/Users/me/.opencode/bin/opencode|$resume"
  "opencode run hello|"
  "opencode api get /api/session|"
  "hx src/app.py|hx src/app.py"
  "/opt/homebrew/bin/helix a.md b.md|/opt/homebrew/bin/helix a.md b.md"
  "node /opt/homebrew/bin/vscode-html-language-server --stdio|"
  "git log --oneline|"
  "npm run dev|"
  "rm -rf build|"
  "rm *|"
  "|"
)
for case in $cases; do
  command=${case%%|*} expected=${case#*|}
  actual=$(run_hook "$command" "$TMP/home")
  if [[ $actual != $expected ]]; then
    print -u2 "FAIL: '$command' -> '$actual' (expected '$expected')"
    failed=1
  fi
done

# A missing hook must print nothing and succeed; a failing hook would make
# Zellij save the raw command (here `rm -rf build`) to rerun it.
if ! actual=$(run_hook "rm -rf build" "$TMP/no-home" 2>/dev/null) || [[ -n $actual ]]; then
  print -u2 "FAIL: a missing hook should succeed without output, got '$actual'"
  failed=1
fi
(( ! failed )) || exit 1
print "resurrect command tests: ok"
