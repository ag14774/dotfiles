#!/usr/bin/env zsh
# Live check of the ADE plugin (packages/opencode-ade, with ade-kit) and the
# status plugin (packages/opencode-ade-status, which tells Zellij when an
# OpenCode pane's work is done) with this checkout's code, against the
# installed Zellij (0.46 or newer), Helix and OpenCode. The OpenCode app in the
# pane showing a conversation (or its parent, for a subagent) opens files and
# delegated tabs for it.
#
# OpenCode runs a private background service with temporary data and config
# (your auth, model preferences and ~/.config/zsh/secrets.zsh are reused), in a
# throwaway Zellij session, so it never touches `main` or your OpenCode service.
# Most steps call the plugin's RPC methods directly; three have an agent use the
# tools (show_file after /cd, delegate from plain English, also into another
# repository). Delegated tabs answer their briefs, and one copy is compacted:
# nine short model calls with your most recent model (or ADE_TEST_MODEL).

set -u

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
S=ade$$
mkdir -p "$TMP"/{A,B,C,zj/layouts,bin,src/plugins} "$TMP"/oc/{data/opencode,state/opencode,cache,config}
: > "$TMP/keys"
: > "$TMP/zj/config.kdl"
cp "$ROOT/config/.config/zellij/layouts/dev.kdl" "$TMP/zj/layouts/"
for f in A/notes B/notes A/other A/bg A/two C/none; do print "I am $f" > "$TMP/$f.md"; done

fail() {
  print -u2 "FAIL: $*"
  exit 1
}
step() { print -- "- $*"; }
zj() { zellij --session "$S" action "$@"; }
uri() { jq -rn --arg d "$1" '$d | @uri'; }
wait_for() { local n=$1; shift; for _ in {1..$n}; do "$@" && return 0; sleep 1; done; return 1; }
gives() { [[ -n $("$@") ]]; } # for wait_for: the command prints something (run on every attempt)
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
oc_cli() { opencode "$@"; }
newest() {
  oc_cli api GET "/api/session?limit=1&order=desc&parentID=null&directory=$(uri "$1")" 2>/dev/null \
    | jq -r '.data[0].id // empty'
}
rpc() { # $1 = method, $2 = directory, $3 = input (JSON): the answer's message
  oc_cli api POST "/api/rpc/ade/$1?location%5Bdirectory%5D=$(uri "$2")" -d "{\"input\":$3}" 2>&1 \
    | jq -r '.output.message // .message // .'
}
rpc_raw() { # $1 = method, $2 = directory, $3 = input (JSON): the whole answer
  oc_cli api POST "/api/rpc/ade/$1?location%5Bdirectory%5D=$(uri "$2")" -d "{\"input\":$3}" 2>/dev/null
}
show() { # $1 = session, then absolute paths
  local sid=$1
  shift
  rpc show_file "$TMP/A" "$(jq -cn --arg s "$sid" '{sessionID: $s, paths: $ARGS.positional}' --args "$@")"
}
has_environment() { # $1 = session
  oc_cli api GET "/api/experimental/session/$1/instructions/entries" 2>/dev/null \
    | jq -e '[.data // . | .[] | select(.key == "ade.environment")] | length > 0' >/dev/null
}
environment_of() { # $1 = session: its environment instructions
  oc_cli api GET "/api/experimental/session/$1/instructions/entries" 2>/dev/null \
    | jq -r '[.data // . | .[] | select(.key == "ade.environment")][0].value // empty'
}
tab_in() { # $1 = directory: a tab with a pane there
  zj list-panes --json 2>/dev/null | jq -r --arg d "$1" '[.[] | select(.is_plugin == false and .pane_cwd == $d)][0].tab_id // empty'
}
dev_tab() { # $1 = directory, $2 = "no-editor" to leave Helix out: a tab like the dev layout's
  local tab
  zj new-tab --cwd "$1" >/dev/null
  sleep 2
  wait_for 30 gives active_tab || fail "no active tab after opening one in $1"
  tab=$(active_tab)
  zj rename-pane main >/dev/null 2>&1
  [[ -n ${2:-} ]] || zj new-pane --cwd "$1" --name editor -- hx >/dev/null
  zj new-pane --cwd "$1" --name opencode -- opencode ${ADE_TEST_MODEL:+--model "$ADE_TEST_MODEL"} >/dev/null
  wait_for 30 gives pane opencode "$tab" || fail "no OpenCode pane in $1"
  sleep 10
  print "$tab"
}
start_conversation() { # $1 = OpenCode pane, $2 = directory: start one with a shell command
  zj write-chars --pane-id "terminal_$1" '!'
  sleep 1
  type_in "$1" 'echo started'
  wait_for 60 gives newest "$2" || fail "no conversation started in $2"
  newest "$2"
}
cleanup() {
  # Stop the private service by its pid (never `opencode service stop`, which
  # stops yours if the environment is lost).
  local service=$TMP/oc/state/opencode/service.json
  [[ -f $service ]] && kill "$(jq -r '.pid' "$service")" 2>/dev/null
  zellij kill-session "$S" >/dev/null 2>&1
  pkill -f "tail -n 0 -f $TMP/keys" 2>/dev/null
  pkill -f "force-run-commands $S" 2>/dev/null
  sleep 1
  zellij delete-session --force "$S" >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT

# Private OpenCode: your config, with a copy of this checkout's plugins linked in
# the way the installer links them (the stale-warning step edits the copy).
cp ~/.local/share/opencode/auth.json "$TMP/oc/data/opencode/" 2>/dev/null
cp ~/.local/state/opencode/model.json "$TMP/oc/state/opencode/" 2>/dev/null
cp -RL ~/.config/opencode "$TMP/oc/config/opencode" 2>/dev/null
config=$TMP/oc/config/opencode
rm -rf "$config"/{service.json,node_modules,plugins/ade.ts,plugins/ade,plugins/ade-status,tui-plugins/ade}
mkdir -p "$config/plugins"
cp -R "$ROOT/packages" "$TMP/src/"
ln -s "$TMP/src/packages/opencode-ade" "$config/plugins/ade"
ln -s "$TMP/src/packages/opencode-ade-status" "$config/plugins/ade-status"
# The plugin's old app part, which the installer removes from cli.json.
[[ -f $config/cli.json ]] || print '{}' > "$config/cli.json"
jq '.plugins = ((.plugins // []) - ["./tui-plugins/ade"])' "$config/cli.json" \
  > "$config/cli.json.new" && mv "$config/cli.json.new" "$config/cli.json"
ln -s "$ROOT/config/.local/bin/wt-core" "$TMP/bin/"
export XDG_DATA_HOME=$TMP/oc/data XDG_STATE_HOME=$TMP/oc/state XDG_CACHE_HOME=$TMP/oc/cache \
  XDG_CONFIG_HOME=$TMP/oc/config PATH="$TMP/bin:$PATH"
unset OPENCODE_PASSWORD OPENCODE_SERVER_PASSWORD
[[ -r ~/.config/zsh/secrets.zsh ]] && source ~/.config/zsh/secrets.zsh
# The private service starts here, inside this caller's Zellij pane, so it
# inherits that pane's Zellij variables (the plugin must remove them).
# Its own port: the managed service's default port is the one yours uses.
oc_cli service set port "$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')" >/dev/null 2>&1
oc_cli service start >"$TMP/service.log" 2>&1
wait_for 30 test -f "$TMP/oc/state/opencode/service.json" || fail "the private OpenCode service did not start"

# Two projects in wt's layout, for delegate: proj, and proj2 to reach from it.
for p in proj proj2; do
  git init -q --bare "$TMP/$p.git"
  git init -q "$TMP/seed-$p" && print seed > "$TMP/seed-$p/README"
  git -C "$TMP/seed-$p" add README && git -C "$TMP/seed-$p" -c user.name=t -c user.email=t@example.com commit -qm init
  git -C "$TMP/seed-$p" push -q "$TMP/$p.git" HEAD:main && git --git-dir="$TMP/$p.git" symbolic-ref HEAD refs/heads/main
  (cd "$TMP" && wt-core clone "$TMP/$p.git" "$p" && cd "$p" && wt-core open --stay main) >/dev/null 2>&1
  [[ -d $TMP/$p/main ]] || fail "could not set up the wt project $p"
done

# Zellij passes this environment (private OpenCode, this checkout's wt-core) on
# to its panes.
(cd "$TMP/A" && tail -n 0 -f "$TMP/keys" | env -u ZELLIJ -u ZELLIJ_SESSION_NAME -u ZELLIJ_PANE_ID TERM=xterm-256color \
  script -q /dev/null zsh -fc "stty rows 50 cols 200; exec zellij --config-dir '$TMP/zj' attach --create --force-run-commands $S" \
  >"$TMP/client.log" 2>&1 &) >/dev/null 2>&1
wait_for 60 session_running || fail "the test session did not start"

tab=$(dev_tab "$TMP/A") || exit 1
oc=$(pane opencode "$tab") ed=$(pane editor "$tab")
sid=$(start_conversation "$oc" "$TMP/A")
! screen_has "$oc" "ADE plugin" || fail "the plugin warned about current code"

step "a conversation a pane shows gets the environment instructions; one no pane shows doesn't"
wait_for 15 has_environment "$sid" || fail "no environment instructions on the conversation"
[[ $(environment_of "$sid") == *"inside a Zellij terminal tab"*"a Helix editor pane"*"with git, wt, zellij"*'`directory`'* ]] \
  || fail "unexpected environment instructions: $(environment_of "$sid")"
loose=$(oc_cli api POST /api/session -d "{\"location\":{\"directory\":\"$TMP/C\"}}" 2>/dev/null | jq -r '.data.id // empty')
[[ -n $loose ]] || fail "could not create a conversation without a pane"
sleep 3
! has_environment "$loose" || fail "a conversation no pane shows got the environment instructions"

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

step "an agent delegates from plain English: a background tab starts on the brief"
tab_p=$(dev_tab "$TMP/proj/main") || exit 1
oc_p=$(pane opencode "$tab_p")
sid_p=$(start_conversation "$oc_p" "$TMP/proj/main")
tabs_before=$(zj list-tabs --json | jq length)
type_in "$oc_p" 'Delegate this to a new worktree named feat-x: reply with exactly the word delegated.'
last_lines() { zj dump-screen --pane-id "$1" 2>/dev/null | grep -v '^[[:space:]]*$' | tail -${2:-12}; }
wait_for 120 gives tab_in "$TMP/proj/feat-x" \
  || fail "no tab opened for the delegated worktree; the agent's pane shows:"$'\n'"$(last_lines "$oc_p")"$'\n'"panes: $(zj list-panes --json | jq -c '[.[] | select(.is_plugin == false) | {id, tab_id, title, cwd: .pane_cwd}]')"
[[ $(active_tab) == "$tab_p" ]] || fail "delegate moved you to the new tab"
(( $(zj list-tabs --json | jq length) == tabs_before + 1 )) || fail "delegate should open exactly one tab"
wait_for 120 gives newest "$TMP/proj/feat-x" || fail "the delegated tab's OpenCode did not start on the brief"

step "the /delegate command is available"
oc_cli api GET "/api/command?location%5Bdirectory%5D=$(uri "$TMP/proj/main")" 2>/dev/null \
  | jq -e '[.. | objects | select(.name? == "delegate")] | length > 0' >/dev/null || fail "no /delegate command"

step "delegate refuses a worktree that already has a tab"
msg=$(rpc delegate "$TMP/proj/main" "$(jq -cn --arg s "$sid_p" '{sessionID: $s, branch: "feat-x", brief: "again"}')")
[[ $msg == "Nothing was delegated:"*"already has a tab"* ]] || fail "unexpected answer: $msg"

step "delegate with full context: a copy of the conversation continues in the new tab"
oc_cli api POST "/api/session/$sid_p/shell" -d '{"command":"echo copy-marker"}' >/dev/null 2>&1
sleep 3
msg=$(rpc delegate "$TMP/proj/main" "$(jq -cn --arg s "$sid_p" \
  '{sessionID: $s, branch: "feat-full", brief: "Reply with exactly the word copied.", context: "full"}')")
[[ $msg == "Opened a background tab for feat-full"*"copy of this conversation"* ]] || fail "unexpected answer: $msg"
wait_for 60 gives tab_in "$TMP/proj/feat-full" || fail "no tab for the copy"
copy=$(newest "$TMP/proj/feat-full")
[[ -n $copy && $copy != "$sid_p" ]] || fail "no copied conversation in the new worktree"
history() { oc_cli api GET "/api/session/$1/context" 2>/dev/null; }
history "$copy" | grep -q copy-marker || fail "the copy lacks the conversation's history"
history_has() { history "$1" | grep -q -- "$2"; }
wait_for 60 history_has "$copy" "word copied" || fail "the copy did not get the brief"
[[ $(oc_cli api GET "/api/session/$sid_p" 2>/dev/null | jq -r '.data.location.directory') == "$TMP/proj/main" ]] \
  || fail "the original conversation should stay where it was"

step "delegate with compact context: the copy is compacted before the brief"
msg=$(rpc delegate "$TMP/proj/main" "$(jq -cn --arg s "$sid_p" \
  '{sessionID: $s, branch: "feat-compact", brief: "Reply with exactly the word compacted.", context: "compact"}')")
[[ $msg == "Opened a background tab for feat-compact"*"compacted copy"* ]] || fail "unexpected answer: $msg"
wait_for 60 gives tab_in "$TMP/proj/feat-compact" || fail "no tab for the compacted copy"
compacted=$(newest "$TMP/proj/feat-compact")
[[ -n $compacted ]] || fail "no compacted conversation in the new worktree"
history "$compacted" | jq -e '[.data // . | .[] | select(.type == "compaction")] | length > 0' >/dev/null \
  || fail "the copy was not compacted"
wait_for 60 history_has "$compacted" "word compacted" || fail "the compacted copy did not get the brief"

step "status shows the project's worktrees, their tabs and conversations"
(cd "$TMP/proj/main" && wt-core open --stay quiet >/dev/null 2>&1) || fail "could not add a worktree without a tab"
status_of() { rpc_raw status "$TMP/proj/main" "{\"sessionID\":\"$sid_p\"}"; }
worktree() { jq -c --arg p "$TMP/proj/$1" '.output.worktrees[] | select(.path == $p)' <<< "$2"; }
settled() { worktree feat-full "$(status_of)" | jq -e '.conversation.state == "idle" and (.conversation.last // "" | test("copied"; "i"))' >/dev/null; }
wait_for 90 settled || fail "status should show the copy idle with its answer: $(worktree feat-full "$(status_of)")"
report=$(status_of)
[[ $(jq -r '.output.ok' <<< "$report") == true ]] || fail "status failed: $report"
[[ $(worktree main "$report" | jq -r '[.tab, .conversation.id] | join(" ")') == "sure $sid_p" ]] \
  || fail "unexpected main worktree: $(worktree main "$report")"
[[ $(worktree feat-x "$report" | jq -r '.tab') == sure ]] || fail "unexpected feat-x worktree: $(worktree feat-x "$report")"
[[ $(worktree quiet "$report" | jq -c '[.tab, .conversation]') == '[null,null]' ]] \
  || fail "unexpected quiet worktree: $(worktree quiet "$report")"
jq -r '.output.message' <<< "$report" | grep -q "proj/main (this conversation): branch main" \
  || fail "unexpected status text: $(jq -r '.output.message' <<< "$report")"

step "delegate and status work on another repository, given a folder in it"
msg=$(rpc delegate "$TMP/proj/main" "$(jq -cn --arg s "$sid_p" \
  '{sessionID: $s, branch: "feat-y", brief: "Reply with exactly the word elsewhere.", directory: "../../proj2/main"}')")
[[ $msg == "Opened a background tab for feat-y (worktree $TMP/proj2/feat-y)"* ]] || fail "unexpected answer: $msg"
wait_for 60 gives tab_in "$TMP/proj2/feat-y" || fail "no tab for the other repository's worktree"
[[ ! -e $TMP/proj/feat-y ]] || fail "the worktree went into the conversation's own repository"
other() { # status for the other repository's project folder: its worktrees and their tabs
  rpc_raw status "$TMP/proj/main" "$(jq -cn --arg s "$sid_p" --arg d "$TMP/proj2" '{sessionID: $s, directory: $d}')" \
    | jq -r '[.output.worktrees[] | "\(.path) \(.tab)"] | sort | join(", ")'
}
other_is() { [[ $(other) == "$1" ]]; }
wait_for 30 other_is "$TMP/proj2/feat-y sure, $TMP/proj2/main null" || fail "unexpected status of the other repository: $(other)"
[[ $(rpc_raw status "$TMP/proj/main" "{\"sessionID\":\"$sid_p\"}" | jq -r '[.output.worktrees[].path | select(startswith($p))] | length' --arg p "$TMP/proj2") == 0 ]] \
  || fail "without directory, status should list the conversation's own repository"
msg=$(rpc delegate "$TMP/proj/main" "$(jq -cn --arg s "$sid_p" --arg d "$TMP/nowhere" '{sessionID: $s, branch: "x", brief: "x", directory: $d}')")
[[ $msg == "Nothing was delegated: $TMP/nowhere is not a folder." ]] || fail "unexpected answer for a missing folder: $msg"

step "an agent delegates into another repository from plain English"
type_in "$oc_p" "Delegate this to a new worktree named feat-z of the repository at $TMP/proj2: reply with exactly the word delegated."
wait_for 120 gives tab_in "$TMP/proj2/feat-z" \
  || fail "no tab opened in the other repository; the agent's pane shows:"$'\n'"$(last_lines "$oc_p")"
[[ ! -e $TMP/proj/feat-z ]] || fail "the agent delegated into its own repository"
[[ $(active_tab) == "$tab_p" ]] || fail "delegate moved you to the new tab"

step "agent status: a tab that finished in the background shows done until you see its pane"
# What Zellij tracks for a pane (OpenCode reports working and waiting, the
# status plugin done and failed); the bar draws it.
pane_status() { # $1 = pane: its status and where it comes from
  zj list-panes --json 2>/dev/null | jq -r --argjson p "$1" \
    '.[] | select(.id == $p and (.is_plugin | not)) | "\(.attention.status) \(.attention.source // "-")"'
}
status_is() { [[ $(pane_status "$1") == "$2" ]]; }
counts() { # $1 = tab: how many of its panes have each status
  zj list-tabs --json 2>/dev/null | jq -c --argjson t "$1" '.[] | select(.tab_id == $t) | .attention.counts | with_entries(select(.value > 0))'
}
full_tab=$(tab_in "$TMP/proj/feat-full")
full_oc=$(pane opencode "$full_tab")
wait_for 30 status_is "$full_oc" "Done ProgramStatus" || fail "expected done from the status plugin, got: $(pane_status "$full_oc")"
[[ $(counts "$full_tab") == '{"done":1}' ]] || fail "the tab (and so the bar) should count one done pane: $(counts "$full_tab")"
back=$(active_tab)
zj go-to-tab-by-id "$full_tab"
wait_for 15 status_is "$full_oc" "Idle -" || fail "seeing the pane should clear done, got: $(pane_status "$full_oc")"
[[ $(counts "$full_tab") == '{}' ]] || fail "the tab still counts: $(counts "$full_tab")"
zj go-to-tab-by-id "$back"
[[ $(pane_status "$oc") != (Done|Failed)* ]] \
  || fail "a pane in view when its agent finished should show neither done nor failed, got: $(pane_status "$oc")"

step "from a tab you are not on: opens in its Helix, and you stay where you are"
zj new-tab --name elsewhere >/dev/null
sleep 2
here=$(active_tab)
msg=$(show "$sid" "$TMP/A/bg.md")
wait_for 10 screen_has "$ed" "I am A/bg" || fail "Helix in the background tab did not show A/bg.md: $msg"
[[ $(active_tab) == "$here" ]] || fail "show_file switched you to another tab"

step "a background tab without Helix: nothing opens, you stay, the caller is told"
tab_c=$(dev_tab "$TMP/C" no-editor) || exit 1
oc_c=$(pane opencode "$tab_c")
sid_c=$(start_conversation "$oc_c" "$TMP/C")
zj go-to-tab-by-id "$here"
sleep 2
msg=$(show "$sid_c" "$TMP/C/none.md")
[[ $msg == *"not the tab you are on"* ]] || fail "unexpected answer: $msg"
[[ $(active_tab) == "$here" ]] || fail "show_file switched you to a tab without Helix"
[[ -z $(pane editor "$tab_c") ]] || fail "show_file opened Helix in a background tab"

step "two panes showing one conversation: exactly one opens the file"
tab_2=$(dev_tab "$TMP/A") || exit 1
ed_2=$(pane editor "$tab_2") oc_2=$(pane opencode "$tab_2")
zj new-pane --in-place --pane-id "terminal_$oc_2" --close-replaced-pane --name opencode --cwd "$TMP/A" \
  -- opencode --session "$sid" >/dev/null
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

# A conversation keeps the environment of the last pane that showed it (OpenCode
# does that); one that never had a pane gets the service's, without Zellij.
step "a conversation that never had a pane sees no Zellij (the service started inside one)"
rm -f "$TMP/C/seen"
oc_cli api POST "/api/session/$loose/shell" \
  -d '{"command":"echo \"[$ZELLIJ$ZELLIJ_SESSION_NAME$ZELLIJ_PANE_ID]\" > seen"}' >/dev/null 2>&1
wait_for 30 test -s "$TMP/C/seen" || fail "the shell command did not run"
[[ $(<"$TMP/C/seen") == "[]" ]] || fail "a conversation without a pane saw Zellij: $(<"$TMP/C/seen")"

# The service reloads a package plugin whose files change, but not when that
# reload fails: then it goes on running the old code.
step "after the server part changes on disk into code that can't load, new OpenCode panes say so"
print 'this is not code (' >> "$TMP/src/packages/opencode-ade/src/server.ts"
sleep 8
zj new-pane --cwd "$TMP/C" -- opencode >/dev/null
sleep 2
fresh=$(zj list-panes --json | jq -r '[.[] | select(.is_plugin == false)] | max_by(.id) | .id')
wait_for 30 screen_has "$fresh" "ADE plugin" || fail "no stale warning in a new OpenCode pane"

print "ade plugin smoke test: ok"
