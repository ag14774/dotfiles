#!/usr/bin/env zsh
# The tests that need no Zellij session, OpenCode service or model: the
# packages' node tests, and the zsh and python tests with stand-ins. The live
# tests run on their own (README, "Tests").

ROOT=${0:A:h:h}
# Stand-ins only: nothing here may reach the Zellij session this runs in.
unset ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID
failed=()

check() { # $1 = name, then the command
  local name=$1 log
  shift
  log=$(mktemp)
  if "$@" >"$log" 2>&1; then
    print "ok    $name"
  else
    print "FAIL  $name"
    cat "$log"
    failed+=("$name")
  fi
  rm -f "$log"
}

for package in "$ROOT"/packages/*(/); do
  check "${package:t}: node --test" zsh -c 'cd "$1" && node --test test/*.test.ts' zsh "$package"
done
for test in ade_open ade_send ade_review_scope worktree resurrect_command gcai gh; do
  check "$test.zsh" zsh "$ROOT/tests/$test.zsh"
done
check zellij_sync_bars.py python3 "$ROOT/tests/zellij_sync_bars.py"
check opencode_cli_config.py uv run -q --no-project --with json5 --with jsonschema python "$ROOT/tests/opencode_cli_config.py"

if (( $#failed )); then
  print -u2 "failed: ${(j:, :)failed}"
  exit 1
fi
print "all passed"
