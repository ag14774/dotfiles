#!/usr/bin/env zsh
# `ade send` pastes a code reference, and the selection as a fenced block, into
# the OpenCode pane of the caller's tab, then focuses it.

set -eu

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
trap 'rm -rf "$TMP"' EXIT

fail() {
  print -u2 "FAIL: $*"
  exit 1
}

mkdir -p "$TMP/bin" "$TMP/home" "$TMP/repo/src" "$TMP/other"
cat > "$TMP/bin/zellij" <<'EOF'
#!/usr/bin/env zsh
[[ $1 == --session ]] && shift 2
[[ $1 == action ]] && shift
if [[ $1 == list-panes ]]; then print -r -- "$FAKE_PANES"; exit; fi
print -r -- "${(j:|:)@}" >> "$FAKE_LOG"
EOF
chmod +x "$TMP/bin/zellij"
export PATH="$TMP/bin:$PATH" HOME="$TMP/home" FAKE_LOG="$TMP/log" ZELLIJ=0 ZELLIJ_SESSION_NAME=test
# Tab 1: Helix (pane 2) and OpenCode (pane 3) in repo. Tab 2: Helix only.
export FAKE_PANES=$(jq -cn --arg repo "$TMP/repo" '[
  {id: 1, tab_id: 1, title: "main", pane_cwd: $repo},
  {id: 2, tab_id: 1, title: "editor", pane_cwd: $repo},
  {id: 3, tab_id: 1, title: "opencode", pane_cwd: $repo},
  {id: 4, tab_id: 2, title: "editor", pane_cwd: $repo}
] | map(. + {is_plugin: false})')

P=$'\e[200~' E=$'\e[201~'
send() { # $1 = caller pane, $2 = directory, $3 = selection, then ade send's arguments
  local pane=$1 dir=$2 selection=$3
  shift 3
  : > "$FAKE_LOG"
  (cd "$dir" && print -rn -- "$selection" | ZELLIJ_PANE_ID=$pane "$ROOT/config/.local/bin/ade" send "$@") 2>"$TMP/err"
}
expect() { # the zellij calls, one per line
  [[ $(<"$FAKE_LOG") == "$1" ]] || fail "expected:"$'\n'"$1"$'\n'"got:"$'\n'"$(<"$FAKE_LOG")"
}

# A cursor (one character) sends just the reference, relative to OpenCode's directory.
send 2 "$TMP/repo" "x" src/app.py 12 12 python || fail "cursor only: $(<"$TMP/err")"
expect "write-chars|--pane-id|terminal_3|${P}src/app.py:12 $E
focus-pane-id|terminal_3"

# A selection adds its line range and its text as a fenced block.
send 2 "$TMP/repo" $'def f():\n    return 1' src/app.py 3 4 python || fail "selection: $(<"$TMP/err")"
expect "write-chars|--pane-id|terminal_3|${P}src/app.py:3-4 $E
write-chars|--pane-id|terminal_3|$P\`\`\`python
def f():
    return 1
\`\`\`$E
write-chars|--pane-id|terminal_3|$P $E
focus-pane-id|terminal_3"

# A file outside OpenCode's directory keeps its absolute path; a selection that
# contains a fence gets a longer one.
send 2 "$TMP/other" $'a\n```\nb' notes.md 1 3 markdown || fail "outside: $(<"$TMP/err")"
[[ $(sed -n 1p "$FAKE_LOG") == "write-chars|--pane-id|terminal_3|$P$TMP/other/notes.md:1-3 $E" ]] \
  || fail "expected an absolute path, got: $(sed -n 1p "$FAKE_LOG")"
grep -qxF "write-chars|--pane-id|terminal_3|$P\`\`\`\`markdown" "$FAKE_LOG" || fail "expected a four-backtick fence: $(<"$FAKE_LOG")"

# A scratch buffer has no file: only the selection.
send 2 "$TMP/repo" "some text" "[scratch]" 1 1 text || fail "scratch: $(<"$TMP/err")"
[[ $(sed -n 1p "$FAKE_LOG") == "write-chars|--pane-id|terminal_3|$P\`\`\`text" ]] \
  || fail "a scratch buffer should send only the selection: $(<"$FAKE_LOG")"

# --text pastes the text as it is: no reference, no fence (the Alt-v review).
send 1 "$TMP/repo" $'1. `a.txt:2` - Use a constant\n2. `b.txt` - Why?' --text || fail "text: $(<"$TMP/err")"
expect "write-chars|--pane-id|terminal_3|${P}1. \`a.txt:2\` - Use a constant
2. \`b.txt\` - Why?$E
focus-pane-id|terminal_3"
if send 1 "$TMP/repo" "" --text; then fail "--text without text should refuse"; fi
grep -q -- "no text to send" "$TMP/err" || fail "expected 'no text to send', got: $(<"$TMP/err")"
[[ ! -s $FAKE_LOG ]] || fail "a refusal must not touch any pane: $(<"$FAKE_LOG")"

# It refuses, touching nothing, without an OpenCode pane in the tab or a caller pane.
for case in "4|this tab has no OpenCode pane" "42|does not exist"; do
  if send "${case%%|*}" "$TMP/repo" "x" src/app.py 1 1; then fail "pane ${case%%|*} should refuse"; fi
  grep -q -- "${case#*|}" "$TMP/err" || fail "expected '${case#*|}', got: $(<"$TMP/err")"
  [[ ! -s $FAKE_LOG ]] || fail "a refusal must not touch any pane: $(<"$FAKE_LOG")"
done

print "ade send tests: ok"
