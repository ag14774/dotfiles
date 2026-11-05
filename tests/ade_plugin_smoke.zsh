#!/usr/bin/env zsh
# Live check of the ADE plugin (server part plugins/ade.ts, app part
# tui-plugins/ade) with this checkout's code, against the installed Zellij,
# Helix and OpenCode. The OpenCode app in the pane showing a conversation (or
# its parent, for a subagent) opens the files the conversation asks for.
#
# It starts a private OpenCode server with temporary data and config (your
# auth, model preferences and ~/.config/zsh/secrets.zsh are reused) and a
# throwaway Zellij session, so it never touches `main` or your OpenCode
# service. Most steps call the plugin's show_file RPC directly; one has an
# agent call the tool, with your most recent model (or ADE_TEST_MODEL).

set -u

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
S=ade$$
mkdir -p "$TMP"/{A,B,C,zj,bin,src/plugins} "$TMP"/oc/{data/opencode,state/opencode,cache,config}
: > "$TMP/keys"
: > "$TMP/zj/config.kdl"
for f in A/notes B/notes A/other A/bg A/two C/none; do print "I am $f" > "$TMP/$f.md"; done

fail() {
  print -u2 "FAIL: $*"
  exit 1
}
step() { print -- "- $*"; }
zj() { zellij --session "$S" action "$@"; }
uri() { jq -rn --arg d "$1" '$d | @uri'; }
wait_for() { local n=$1; shift; for _ in {1..$n}; do "$@" && return 0; sleep 1; done; return 1; }
session_running() { zellij list-sessions --no-formatting 2>/dev/null | grep "^$S " | grep -qv EXITED; }
pane() { # $1 = title, $2 = tab: pane ID
  zj list-panes --json 2>/dev/null | jq -r --arg t "$1" --argjson tab "$2" \
    '[.[] | select(.is_plugin == false and .title == $t and .tab_id == $tab)][0].id // empty'
}
active_tab() { zj list-tabs --json 2>/dev/null | jq -r '.[] | select(.active) | .tab_id'; }
screen_has() { zj dump-screen --pane-id "$1" 2>/dev/null | grep -q -- "$2"; }
type_in() { # $1 = pane, $2 = text, then Enter
  zj write-chars --pane-id "terminal_$1" "$2"
  sleep 1
  zj write --pane-id "terminal_$1" 13
}
oc_cli() { opencode --server "$OPENCODE_SERVER" "$@"; }
newest() {
  oc_cli api GET "/api/session?limit=1&order=desc&parentID=null&directory=$(uri "$1")" 2>/dev/null \
    | jq -r '.data[0].id // empty'
}
show() { # $1 = session, then absolute paths: the show_file RPC's message
  local sid=$1
  shift
  oc_cli api POST "/api/rpc/ade/show_file?directory=$(uri "$TMP/A")" \
    -d "$(jq -cn --arg s "$sid" '{input: {sessionID: $s, paths: $ARGS.positional}}' --args "$@")" 2>&1 \
    | jq -r '.output.message // .message // .'
}
dev_tab() { # $1 = directory, $2 = "no-editor" to leave Helix out: a tab like the dev layout's
  local tab
  zj new-tab --cwd "$1" >/dev/null
  sleep 2
  tab=$(active_tab)
  zj rename-pane main >/dev/null 2>&1
  [[ -n ${2:-} ]] || zj new-pane --cwd "$1" --name editor -- hx >/dev/null
  zj new-pane --cwd "$1" --name opencode -- \
    opencode --server "$OPENCODE_SERVER" ${ADE_TEST_MODEL:+--model "$ADE_TEST_MODEL"} >/dev/null
  wait_for 30 test -n "$(pane opencode "$tab")" || fail "no OpenCode pane in $1"
  sleep 10
  print "$tab"
}
start_conversation() { # $1 = OpenCode pane, $2 = directory: start one with a shell command
  zj write-chars --pane-id "terminal_$1" '!'
  sleep 1
  type_in "$1" 'echo started'
  wait_for 60 test -n "$(newest "$2")" || fail "no conversation started in $2"
  newest "$2"
}
cleanup() {
  [[ -n ${server_pid:-} ]] && kill "$server_pid" 2>/dev/null
  zellij kill-session "$S" >/dev/null 2>&1
  pkill -f "tail -n 0 -f $TMP/keys" 2>/dev/null
  pkill -f "force-run-commands $S" 2>/dev/null
  sleep 1
  zellij delete-session --force "$S" >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT

# Private OpenCode: your config, with a copy of this checkout's plugin linked in
# the way the installer links it (the stale-warning step edits the copy).
cp ~/.local/share/opencode/auth.json "$TMP/oc/data/opencode/" 2>/dev/null
cp ~/.local/state/opencode/model.json "$TMP/oc/state/opencode/" 2>/dev/null
cp -RL ~/.config/opencode "$TMP/oc/config/opencode" 2>/dev/null
config=$TMP/oc/config/opencode
rm -rf "$config"/{service.json,node_modules,plugins/ade.ts,tui-plugins/ade}
mkdir -p "$config"/{plugins,tui-plugins} "$TMP/src/tui-plugins"
cp "$ROOT/config/.config/opencode/plugins/ade.ts" "$TMP/src/plugins/"
cp -R "$ROOT/config/.config/opencode/tui-plugins/ade" "$TMP/src/tui-plugins/"
ln -s "$TMP/src/plugins/ade.ts" "$config/plugins/"
mkdir -p "$config/tui-plugins/ade"
for f in "$TMP"/src/tui-plugins/ade/*; do ln -s "$f" "$config/tui-plugins/ade/"; done
[[ -f $config/cli.json ]] || print '{}' > "$config/cli.json"
jq '.plugins = ((.plugins // []) - ["./tui-plugins/ade"] + ["./tui-plugins/ade"])' "$config/cli.json" \
  > "$config/cli.json.new" && mv "$config/cli.json.new" "$config/cli.json"
ln -s "$ROOT/config/.local/bin/hx-open" "$TMP/bin/"
export XDG_DATA_HOME=$TMP/oc/data XDG_STATE_HOME=$TMP/oc/state XDG_CACHE_HOME=$TMP/oc/cache \
  XDG_CONFIG_HOME=$TMP/oc/config OPENCODE_PASSWORD=ade-test-$$ PATH="$TMP/bin:$PATH"
zsh -fc '[[ -r ~/.config/zsh/secrets.zsh ]] && source ~/.config/zsh/secrets.zsh
  exec opencode serve --hostname 127.0.0.1 --port 0' >"$TMP/server.log" 2>&1 &
server_pid=$!
wait_for 30 grep -q 'listening on http' "$TMP/server.log" || fail "the private OpenCode server did not start"
export OPENCODE_SERVER=$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$TMP/server.log" | head -1)

# Zellij passes this environment (private OpenCode, this checkout's hx-open)
# on to its panes.
(cd "$TMP/A" && tail -n 0 -f "$TMP/keys" | env -u ZELLIJ -u ZELLIJ_SESSION_NAME -u ZELLIJ_PANE_ID TERM=xterm-256color \
  script -q /dev/null zsh -fc "stty rows 50 cols 200; exec zellij --config-dir '$TMP/zj' attach --create --force-run-commands $S" \
  >"$TMP/client.log" 2>&1 &) >/dev/null 2>&1
wait_for 60 session_running || fail "the test session did not start"

tab=$(dev_tab "$TMP/A")
oc=$(pane opencode "$tab") ed=$(pane editor "$tab")
sid=$(start_conversation "$oc" "$TMP/A")
! screen_has "$oc" "ADE plugin" || fail "the plugin warned about current code"

step "show_file opens the file in this tab's Helix"
msg=$(show "$sid" "$TMP/A/notes.md")
[[ $msg == Opened* ]] || fail "unexpected answer: $msg"
wait_for 10 screen_has "$ed" "I am A/notes" || fail "Helix did not show A/notes.md"

step "an agent calls show_file after /cd: the path follows the conversation, the file opens here"
type_in "$oc" "/cd $TMP/B"
sleep 3
zj write --pane-id "terminal_$oc" 13
sleep 5
type_in "$oc" 'Call the show_file tool with paths ["notes.md"]. Do nothing else.'
wait_for 120 screen_has "$ed" "I am B/notes" || fail "Helix did not show B/notes.md"

step "a subagent's request opens in its parent's tab"
child=$(oc_cli api POST "/api/session?directory=$(uri "$TMP/B")" -d "{\"parentID\":\"$sid\"}" 2>/dev/null | jq -r '.data.id // empty')
[[ -n $child ]] || fail "could not create a child conversation"
msg=$(show "$child" "$TMP/A/other.md")
[[ $msg == Opened* ]] || fail "unexpected answer for the subagent: $msg"
wait_for 10 screen_has "$ed" "I am A/other" || fail "Helix did not show the subagent's file"

step "from a tab you are not on: opens in its Helix, and you stay where you are"
zj new-tab --name elsewhere >/dev/null
sleep 2
here=$(active_tab)
msg=$(show "$sid" "$TMP/A/bg.md")
wait_for 10 screen_has "$ed" "I am A/bg" || fail "Helix in the background tab did not show A/bg.md: $msg"
[[ $(active_tab) == "$here" ]] || fail "show_file switched you to another tab"

step "a background tab without Helix: nothing opens, you stay, the caller is told"
tab_c=$(dev_tab "$TMP/C" no-editor)
oc_c=$(pane opencode "$tab_c")
sid_c=$(start_conversation "$oc_c" "$TMP/C")
zj go-to-tab-by-id "$here"
sleep 2
msg=$(show "$sid_c" "$TMP/C/none.md")
[[ $msg == *"not the tab you are on"* ]] || fail "unexpected answer: $msg"
[[ $(active_tab) == "$here" ]] || fail "show_file switched you to a tab without Helix"
[[ -z $(pane editor "$tab_c") ]] || fail "show_file opened Helix in a background tab"

step "two panes showing one conversation: exactly one opens the file"
tab_2=$(dev_tab "$TMP/A")
ed_2=$(pane editor "$tab_2") oc_2=$(pane opencode "$tab_2")
zj new-pane --in-place --pane-id "terminal_$oc_2" --close-replaced-pane --name opencode --cwd "$TMP/A" \
  -- opencode --server "$OPENCODE_SERVER" --session "$sid" >/dev/null
sleep 10
oc_2=$(pane opencode "$tab_2")
screen_has "$oc_2" "show_file" || fail "the second pane is not showing the conversation"
show "$sid" "$TMP/A/two.md" >/dev/null
sleep 3
n=0
for e in "$ed" "$ed_2"; do screen_has "$e" "I am A/two" && (( n++ )); done
(( n == 1 )) || fail "$n panes opened the file"

step "a conversation no pane shows: nothing opens, and the caller is told"
for p in "$oc" "$oc_2"; do zj write --pane-id "terminal_$p" 3; sleep 1; zj write --pane-id "terminal_$p" 3; done
sleep 3
msg=$(show "$sid" "$TMP/B/notes.md")
[[ $msg == "No OpenCode pane in Zellij is showing this conversation"* ]] || fail "unexpected answer: $msg"

step "its shell commands see no Zellij (the server started inside one)"
rm -f "$TMP/B/seen"
oc_cli api POST "/api/session/$sid/shell" \
  -d '{"command":"echo \"[$ZELLIJ$ZELLIJ_SESSION_NAME$ZELLIJ_PANE_ID]\" > seen"}' >/dev/null 2>&1
wait_for 30 test -s "$TMP/B/seen" || fail "the shell command did not run"
[[ $(<"$TMP/B/seen") == "[]" ]] || fail "a conversation no pane shows saw Zellij: $(<"$TMP/B/seen")"

step "after the server part changes on disk, OpenCode panes say the service is out of date"
digest() { oc_cli api POST "/api/rpc/ade/info?directory=$(uri "$TMP/A")" -d '{"input":{}}' 2>/dev/null | jq -r '.output.digest'; }
before=$(digest)
print '// changed' >> "$TMP/src/plugins/ade.ts"
sleep 8
if [[ $(digest) != "$before" ]]; then
  print "  (OpenCode reloaded the symlinked plugin: the stale warning may no longer be needed)"
else
  zj new-pane --cwd "$TMP/C" -- opencode --server "$OPENCODE_SERVER" >/dev/null
  sleep 2
  fresh=$(zj list-panes --json | jq -r '[.[] | select(.is_plugin == false)] | max_by(.id) | .id')
  wait_for 30 screen_has "$fresh" "ADE plugin" || fail "no stale warning in a new OpenCode pane"
fi

print "ade plugin smoke test: ok"
