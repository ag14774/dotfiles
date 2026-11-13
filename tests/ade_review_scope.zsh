#!/usr/bin/env zsh
# What the Alt-v review covers (`ade review --scope`): the commits since the
# merge base with origin/HEAD (-r BASE..HEAD) and uncommitted changes (-w).

set -eu

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
trap 'rm -rf "$TMP"' EXIT

fail() {
  print -u2 "FAIL: $*"
  exit 1
}
scope() { # $1 = directory
  local out
  out=$(cd "$1" && "$ROOT/config/.local/bin/ade" review --scope) || return
  print -r -- ${(j: :)${(f)out}}
}
check() { # $1 = case, $2 = directory, $3 = expected scope
  local got
  got=$(scope "$2") || fail "$1: ade review --scope failed"
  [[ $got == "$3" ]] || fail "$1: expected '$3', got '$got'"
}

git init -q --bare "$TMP/origin.git"
git init -q -b main "$TMP/seed"
git -C "$TMP/seed" config user.name Test
git -C "$TMP/seed" config user.email test@example.com
print one > "$TMP/seed/a.txt"
git -C "$TMP/seed" add a.txt
git -C "$TMP/seed" commit -qm base
git -C "$TMP/seed" push -q "$TMP/origin.git" main
git clone -q "$TMP/origin.git" "$TMP/work"
W=$TMP/work
git -C "$W" config user.name Test
git -C "$W" config user.email test@example.com
base=$(git -C "$W" rev-parse HEAD)

check "default branch, clean" "$W" ""

git -C "$W" switch -qc agent
print two >> "$W/a.txt"
git -C "$W" commit -qam "agent work"
check "agent commits" "$W" "-r $base..HEAD"

print new > "$W/b.txt"
check "agent commits and a new file" "$W" "-r $base..HEAD -w"

# HEAD at the merge base, a branch's changes staged (detached).
git -C "$W" add b.txt
git -C "$W" switch -q --detach
git -C "$W" reset -q --soft "$base"
check "staged on the merge base" "$W" "-w"

mkdir "$W/sub"
check "from a subdirectory" "$W/sub" "-w"

# Without origin/HEAD, only uncommitted changes can be reviewed.
git init -q -b main "$TMP/local"
git -C "$TMP/local" config user.name Test
git -C "$TMP/local" config user.email test@example.com
print one > "$TMP/local/a.txt"
git -C "$TMP/local" add a.txt
git -C "$TMP/local" commit -qm base
check "no remote, clean" "$TMP/local" ""
print edit >> "$TMP/local/a.txt"
check "no remote, edited" "$TMP/local" "-w"

mkdir "$TMP/plain"
if scope "$TMP/plain" >/dev/null 2>&1; then fail "outside a repository, --scope should fail"; fi

print "ade review scope tests: ok"
