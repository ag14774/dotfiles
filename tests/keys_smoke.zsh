#!/usr/bin/env zsh
# Live check of the keys that tie the panes together, with this checkout's
# scripts, against the installed Zellij, Helix, Yazi and tuicr:
#   - Alt-y: the file picked in Yazi opens in the tab's editor pane;
#   - Helix `+ a`: the selection goes to the tab's OpenCode pane;
#   - Alt-v: a tuicr review of the branch (commits and uncommitted changes);
#     `e` opens a file in the editor pane, a second Alt-v brings the same
#     review back, `y` pastes the comments into the OpenCode pane.
#
#   zsh tests/keys_smoke.zsh
#
# It drives a throwaway session through a headless terminal; every Zellij
# command names that session. A pane running `cat` stands in for OpenCode, so
# no model is called. Helix gets a copy of this checkout's config whose `+ a`
# calls this checkout's opencode-send; your other ~/.config folders are used as
# they are (Yazi's plugins live there). tuicr's records of the test's review
# are removed afterwards.

set -u

ROOT=${0:A:h:h}
fail() {
  print -u2 "FAIL: $*"
  exit 1
}
step() { print -r -- "- $*"; }

HELIX=${commands[hx]:-${commands[helix]:-}}
for tool in zellij jq script tail yazi tuicr git; do
  (( $+commands[$tool] )) || fail "$tool is not installed"
done
[[ -n $HELIX ]] || fail "Helix (hx or helix) is not installed"

# Never inherit the session this test is started from.
unset ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID
TMP=$(mktemp -d)
TMP=${TMP:A}
S=keys-smoke-$$
zellij list-sessions --no-formatting 2>/dev/null | grep -q "^$S " && fail "session $S already exists"

forget_reviews() { # tuicr keeps a session file per review and an index entry
  local f dir
  tuicr review list --all 2>/dev/null | jq -r --arg tmp "$TMP" \
    '.[] | select((.canonical_repo_path // .slug // "") | contains($tmp | split("/") | last)) | .path' \
    | while IFS= read -r f; do
      [[ -n $f ]] || continue
      dir=${f:h:h}
      rm -f -- "$f"
      [[ -f $dir/index.json ]] && jq --arg tmp "${TMP:t}" \
        '.entries |= with_entries(select([.value[]?.canonical_repo_path // ""] | map(contains($tmp)) | any | not))' \
        "$dir/index.json" > "$dir/index.json.new" && mv "$dir/index.json.new" "$dir/index.json"
    done
}
cleanup() {
  zellij kill-session "$S" >/dev/null 2>&1
  pkill -f "tail -n 0 -f $TMP/keys" 2>/dev/null
  sleep 1
  zellij delete-session --force "$S" >/dev/null 2>&1
  forget_reviews
  rm -rf "$TMP"
}
trap cleanup EXIT

zj() { zellij --session "$S" action "$@"; }
wait_for() { local n=$1; shift; for _ in {1..$n}; do "$@" && return 0; sleep 1; done; return 1; }
session_running() { zellij list-sessions --no-formatting 2>/dev/null | grep "^$S " | grep -qv EXITED; }
pane() { # $1 = title: the first live pane with it
  zj list-panes --json 2>/dev/null | jq -r --arg t "$1" \
    '[.[] | select(.is_plugin == false and .title == $t and ((.exited or .is_held) | not))][0].id // empty'
}
has_pane() { [[ -n $(pane "$1") ]]; }
no_pane() { [[ -z $(pane "$1") ]]; }
count() { zj list-panes --json 2>/dev/null | jq --arg t "$1" '[.[] | select(.is_plugin == false and .title == $t)] | length'; }
focused() { # $1 = title: is that pane focused (among the tiled panes, or the floating ones)?
  zj list-panes --json 2>/dev/null | jq -e --arg t "$1" '[.[] | select(.title == $t and .is_focused)] | length > 0' >/dev/null
}
screen_has() { zj dump-screen --pane-id "terminal_$(pane "$1")" 2>/dev/null | grep -qF -- "$2"; }
keys_to() { zj write-chars --pane-id "terminal_$(pane "$1")" "$2"; sleep "${3:-1}"; }
enter_in() { zj write --pane-id "terminal_$(pane "$1")" 13; sleep "${2:-1}"; }
press() { print -rn -- "$1" >> "$TMP/keys"; } # through the client: Zellij's own keys

# This checkout's Zellij config, its keys pointing at this checkout's scripts.
mkdir -p "$TMP/zj"
sed "s|\$HOME/.config/zellij/|$ROOT/config/.config/zellij/|g" "$ROOT/config/.config/zellij/config.kdl" > "$TMP/zj/config.kdl"
grep -q "$ROOT/config/.config/zellij/review.sh" "$TMP/zj/config.kdl" || fail "could not point Alt-v at this checkout"
grep -q "$ROOT/config/.config/zellij/yazi-picker.sh" "$TMP/zj/config.kdl" || fail "could not point Alt-y at this checkout"

# Your config folders, except Helix: this checkout's, with `+ a` calling this
# checkout's opencode-send.
mkdir -p "$TMP/config"
for d in ~/.config/*(N); do [[ ${d:t} == helix ]] || ln -s "$d" "$TMP/config/"; done
cp -R "$ROOT/config/.config/helix" "$TMP/config/helix"
sed -i.orig "s|\$HOME/.local/bin/opencode-send|$ROOT/config/.local/bin/opencode-send|g" "$TMP/config/helix/config.toml"
grep -q "$ROOT/config/.local/bin/opencode-send" "$TMP/config/helix/config.toml" || fail "could not point + a at this checkout"

# A clone whose branch has a commit (a.txt changed, c.txt added) and an
# uncommitted new file (b.txt).
git init -q --bare "$TMP/origin.git"
git init -q -b main "$TMP/seed"
printf 'line1\nline2\n' > "$TMP/seed/a.txt"
git -C "$TMP/seed" add a.txt
git -C "$TMP/seed" -c user.name=t -c user.email=t@t commit -qm base
git -C "$TMP/seed" push -q "$TMP/origin.git" main
git clone -q "$TMP/origin.git" "$TMP/repo"
R=$TMP/repo
git -C "$R" switch -qc agent
printf 'line1\nline2\nagent line\n' > "$R/a.txt"
print 'c content' > "$R/c.txt"
git -C "$R" add a.txt c.txt
git -C "$R" -c user.name=t -c user.email=t@t commit -qm "agent work"
print 'b content' > "$R/b.txt"

cat > "$TMP/layout.kdl" <<EOF
layout {
    pane split_direction="vertical" {
        pane name="main" cwd="$R" focus=true
        pane name="opencode" cwd="$R" command="cat"
    }
}
EOF

# A headless client in a pseudo-terminal; text appended to $TMP/keys becomes
# keystrokes. Started in the repository: a floating pane starts in the
# session's directory, so that is where Yazi opens.
: > "$TMP/keys"
cmd="stty rows 50 cols 200; exec zellij --config-dir '$TMP/zj' --session '$S' --new-session-with-layout '$TMP/layout.kdl'"
if script --version 2>/dev/null | grep -q util-linux; then
  (cd "$R" && tail -n 0 -f "$TMP/keys" | env TERM=xterm-256color XDG_CONFIG_HOME="$TMP/config" \
    XDG_CACHE_HOME="$TMP/cache" script -qfc "$cmd" /dev/null >"$TMP/client.log" 2>&1 &)
else
  (cd "$R" && tail -n 0 -f "$TMP/keys" | env TERM=xterm-256color XDG_CONFIG_HOME="$TMP/config" \
    XDG_CACHE_HOME="$TMP/cache" script -q /dev/null zsh -fc "$cmd" >"$TMP/client.log" 2>&1 &)
fi
wait_for 60 session_running || fail "the test session did not start"
wait_for 30 has_pane opencode || fail "no OpenCode stand-in pane"
sleep 2

step "Alt-y: the file picked in Yazi opens in the tab's editor pane"
press $'\ey'
wait_for 30 has_pane yazi || fail "Alt-y opened no picker"
wait_for 30 screen_has yazi c.txt || fail "Yazi did not list the repository"
enter_in yazi 2
wait_for 30 no_pane yazi || fail "the picker did not close after picking"
wait_for 30 has_pane editor || fail "no editor pane after picking"
wait_for 30 screen_has editor "agent line" || fail "the editor does not show a.txt"
focused editor || fail "the editor pane is not focused"

step "Helix + a: the selection goes to the tab's OpenCode pane"
keys_to editor x
keys_to editor "+a" 2
wait_for 15 screen_has opencode "a.txt:1" || fail "OpenCode got no reference to a.txt:1"
screen_has opencode "line1" || fail "OpenCode got no selected text"
focused opencode || fail "the OpenCode pane is not focused"

step "Alt-v: a review of the branch's commits and uncommitted changes"
zj focus-pane-id "terminal_$(pane main)"
sleep 1
press $'\ev'
wait_for 30 has_pane review || fail "Alt-v opened no review"
wait_for 30 screen_has review "git:agent" || fail "the review is not on the branch"
screen_has review "staged + unstaged + commit" || fail "the review does not cover commits and uncommitted changes"
screen_has review "b.txt" || fail "the review misses the uncommitted file"
screen_has review "c.txt" || fail "the review misses the committed file"

step "the review: a comment, then e opens the file in the editor pane"
keys_to review ";j"
for _ in 1 2 3; do keys_to review j 0.5; done
keys_to review c
keys_to review "Use a constant here" 0.5
enter_in review 2
keys_to review "}" 0.5
keys_to review "}" 0.5
keys_to review e 4
wait_for 15 screen_has editor "c content" || fail "e did not open c.txt in the editor pane"
[[ $(count editor) == 1 ]] || fail "e started a second editor"

step "Alt-v again brings the same review back"
press $'\ev'
sleep 4
[[ $(count review) == 1 ]] || fail "a second Alt-v started another review ($(count review))"
focused review || fail "the review is not focused after Alt-v"

step "y ends the review and pastes the comments into the OpenCode pane"
keys_to review y 4
wait_for 15 no_pane review || fail "the review did not close"
wait_for 15 screen_has opencode "Use a constant here" || fail "OpenCode did not get the comment"
screen_has opencode "a.txt:2" || fail "the comment lost its place (a.txt:2)"
focused opencode || fail "the OpenCode pane is not focused"

print "keys smoke test: ok"
