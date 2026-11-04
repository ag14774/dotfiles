#!/usr/bin/env zsh
# Zellij reruns whatever resurrect-command.sh lets through when it restores a
# session, so only Helix and the OpenCode TUI may pass.

set -eu

ROOT=${0:A:h:h}
HOOK=$ROOT/config/.config/zellij/resurrect-command.sh
resume="$HOME/.local/bin/opencode-pane --resume"
failed=0

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
  # Zellij runs the hook through `sh -c`.
  actual=$(RESURRECT_COMMAND=$command sh "$HOOK")
  if [[ $actual != $expected ]]; then
    print -u2 "FAIL: '$command' -> '$actual' (expected '$expected')"
    failed=1
  fi
done
(( ! failed )) || exit 1
print "resurrect command tests: ok"
