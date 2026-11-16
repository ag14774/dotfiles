#!/usr/bin/env zsh
# The wt* functions (shell/worktree.zsh) and ocreload (shell/ocreload.zsh),
# with a stand-in for ade: wt cds where ade reports, passes a zsh ADE_SEED
# array along and returns ade's status; ocreload is ade restart-agent
# --reload, with its status. What ade itself does is tested in its
# repository.

set -eu

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
trap 'rm -rf "$TMP"' EXIT
fail() {
  print -u2 "FAIL: $*"
  exit 1
}

mkdir -p "$TMP/bin" "$TMP/tmp" "$TMP/repo/feat"
export LOG=$TMP/log TMPDIR=$TMP/tmp WT_DIR=$TMP/repo/feat PATH="$TMP/bin:$PATH"
# ade: logs its arguments and ADE_SEED; `worktree --cwd-file FILE open NAME`
# reports $WT_DIR unless -s is given; `worktree --cwd-file FILE rm bad` fails,
# and so does restart-agent with RELOAD_FAILS set.
cat > "$TMP/bin/ade" <<'EOF'
#!/bin/sh
printf 'ade %s\n' "$*" >> "$LOG"
[ -n "${ADE_SEED+x}" ] && printf 'ADE_SEED=%s\n' "$ADE_SEED" >> "$LOG"
[ "$1" = restart-agent ] && [ -n "${RELOAD_FAILS:-}" ] && exit 4
[ "$1 $2" = "worktree --cwd-file" ] || exit 0
file=$3
shift 3
case "$*" in
  "open -s"*) echo "$WT_DIR" ;;
  open*) echo "$WT_DIR" > "$file" ;;
  "rm bad") exit 3 ;;
esac
exit 0
EOF
chmod +x "$TMP/bin/ade"

source "$ROOT/shell/worktree.zsh"
source "$ROOT/shell/ocreload.zsh"
cd "$TMP/repo"

wt feat >/dev/null || fail "wt feat failed"
[[ $PWD == $WT_DIR ]] || fail "wt should cd into the worktree, is in $PWD"
grep -q "^ade worktree --cwd-file $TMP/tmp/wt-cwd\.[^ ]* open feat$" "$LOG" || fail "wt should run ade worktree open: $(<"$LOG")"

cd "$TMP/repo"
out=$(wt -s feat)
[[ $out == $WT_DIR && $PWD == $TMP/repo ]] || fail "wt -s should print the path and stay"

: > "$LOG"
ADE_SEED=(.env '.env.*')
wt feat >/dev/null
unset ADE_SEED
[[ $(<"$LOG") == *$'ADE_SEED=.env\n.env.*'* ]] || fail "wt should pass ADE_SEED newline-separated: $(<"$LOG")"

cd "$TMP/repo"
rc=0
wtrm bad || rc=$?
(( rc == 3 )) || fail "wtrm should return ade's status (3), not $rc"
[[ $PWD == $TMP/repo ]] || fail "a failed wtrm should not cd"
[[ -z $(print -l "$TMP/tmp"/*(N)) ]] || fail "wt left its cwd file behind"

: > "$LOG"
ocreload || fail "ocreload failed"
[[ $(<"$LOG") == "ade restart-agent --reload" ]] || fail "ocreload should run ade restart-agent --reload: $(<"$LOG")"
rc=0
RELOAD_FAILS=1 ocreload || rc=$?
(( rc == 4 )) || fail "ocreload should return ade's status (4), not $rc"
print "wt test: ok"
