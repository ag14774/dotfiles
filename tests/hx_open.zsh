#!/usr/bin/env zsh
# `ade open` (behind hx-open) opens files in the Helix of the caller's tab,
# found from $ZELLIJ_PANE_ID. It refuses to guess when that pane is gone, and
# never switches you to a tab you are not on.

set -eu

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
trap 'rm -rf "$TMP"' EXIT

fail() {
  print -u2 "FAIL: $*"
  exit 1
}

mkdir -p "$TMP/bin" "$TMP/home/.config/zellij" "$TMP/repo/src" "$TMP/other"
ln -s "$ROOT/config/.config/zellij/pane-id.sh" "$TMP/home/.config/zellij/"
for d in repo other; do git -C "$TMP/$d" init -q; done
cat > "$TMP/bin/zellij" <<'EOF'
#!/usr/bin/env zsh
[[ $1 == --session ]] && shift 2
[[ $1 == action ]] && shift
print -r -- "$*" >> "$FAKE_LOG"
[[ $1 == list-panes ]] && print -r -- "$FAKE_PANES"
[[ $1 == list-tabs ]] && print -r -- "$FAKE_TABS"
exit 0
EOF
print '#!/bin/sh' > "$TMP/bin/hx"
chmod +x "$TMP/bin/zellij" "$TMP/bin/hx"
export PATH="$TMP/bin:$PATH" HOME="$TMP/home" FAKE_LOG="$TMP/log" ZELLIJ=0 ZELLIJ_SESSION_NAME=test
unset HX_OPEN_LOG ADE_LOG
# You are on tab 1 (repo). Tab 2 (other) has a Helix, tab 3 none, tab 4 a
# stopped one. Pane 5 (OpenCode starting) reports no directory.
export FAKE_TABS='[{"tab_id":1,"active":true},{"tab_id":2,"active":false},{"tab_id":3,"active":false},{"tab_id":4,"active":false}]'
export FAKE_PANES=$(jq -cn --arg repo "$TMP/repo" --arg other "$TMP/other" '[
  {id: 1, tab_id: 1, title: "main", pane_cwd: $repo},
  {id: 2, tab_id: 1, title: "editor", pane_cwd: $repo},
  {id: 3, tab_id: 2, title: "main", pane_cwd: $other},
  {id: 4, tab_id: 2, title: "editor", pane_cwd: $other},
  {id: 5, tab_id: 1, title: "opencode", pane_cwd: null},
  {id: 6, tab_id: 3, title: "main", pane_cwd: $other},
  {id: 7, tab_id: 4, title: "main", pane_cwd: $other},
  {id: 8, tab_id: 4, title: "editor", pane_cwd: null, exited: true}
] | map({is_plugin: false, exited: false, is_held: false} + .)')

hx_open() { # $1 = caller pane, $2 = directory; output in $FAKE_LOG and $TMP/err
  : > "$FAKE_LOG"
  (cd "$2" && ZELLIJ_PANE_ID=$1 "$ROOT/config/.local/bin/ade" open notes.md) 2>"$TMP/err"
}
called() { grep -q -- "$1" "$FAKE_LOG"; }

opens_in() { # $1 = caller pane, $2 = directory, $3 = editor pane, $4 = "focus" or "no-focus"
  hx_open "$1" "$2" || fail "hx-open from pane $1 in $2 failed: $(<"$TMP/err")"
  called "^write-chars --pane-id terminal_$3 :open \"$2/notes.md\"" \
    || fail "pane $1 in $2 should open the file in editor $3, got: $(<"$FAKE_LOG")"
  if [[ $4 == focus ]]; then
    called "^focus-pane-id terminal_$3" || fail "editor $3 should get focus"
  elif called '^\(focus-pane-id\|go-to-tab-by-id\)'; then
    fail "a background tab must not take focus: $(<"$FAKE_LOG")"
  fi
}
refuses() { # $1 = caller pane, $2 = expected reason
  if hx_open "$1" "$TMP/repo"; then fail "hx-open from pane $1 should refuse"; fi
  grep -q -- "$2" "$TMP/err" || fail "expected '$2', got: $(<"$TMP/err")"
  ! called '^\(write\|write-chars\|new-pane\|go-to-tab-by-id\|focus-pane-id\) ' \
    || fail "a refused hx-open must not touch any pane: $(<"$FAKE_LOG")"
}

opens_in 1 "$TMP/repo" 2 focus
opens_in 1 "$TMP/repo/src" 2 focus
opens_in 5 "$TMP/repo" 2 focus
# A conversation moved with /cd runs in another directory than its pane.
opens_in 1 "$TMP/other" 2 focus
opens_in 3 "$TMP/repo" 4 no-focus
refuses 42 "does not exist"
refuses 6 "has no editor and is not the tab you are on"

hx_open 7 "$TMP/repo" || fail "a stopped editor in a background tab should be replaced: $(<"$TMP/err")"
called '^new-pane --in-place --pane-id terminal_8 .*--no-focus' \
  || fail "the stopped editor should be replaced without focus: $(<"$FAKE_LOG")"
! called '^\(focus-pane-id\|go-to-tab-by-id\)' || fail "a background tab must not take focus"

print "hx-open tests: ok"
