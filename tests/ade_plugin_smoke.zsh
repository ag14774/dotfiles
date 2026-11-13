#!/usr/bin/env zsh
# Live check of the ADE plugin (packages/opencode-ade, with ade-kit) and the
# status plugin (packages/opencode-ade-status, which tells Zellij when an
# OpenCode pane's work is done) with this checkout's code, against the
# installed Zellij (0.46 or newer), Helix and OpenCode. The OpenCode app in the
# pane showing a conversation (or its parent, for a subagent) opens files and
# delegated tabs for it.
#
# OpenCode runs a private background service with temporary data and config
# (your auth, Google credentials, model preferences and
# ~/.config/zsh/secrets.zsh are reused), on a port of its own, in a throwaway
# Zellij session in a sandbox (tests/lib/zellij-sandbox.zsh: its own Zellij
# server and HOME), so it never touches `main`, your Zellij cache or your
# OpenCode service. Most steps call the plugin's RPC methods directly; three
# have an agent use the tools (show_file after /cd, delegate from plain English,
# also into another repository). Delegated tabs answer their briefs, and one
# copy is compacted: nine short model calls with your most recent model (or
# ADE_TEST_MODEL). When a step fails, the screen of its OpenCode pane is shown.

set -u

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
S=ade$$
source "$ROOT/tests/lib/zellij-sandbox.zsh"
sandbox_init "$TMP/zj"
REAL=$SANDBOX_REAL_HOME
mkdir -p "$TMP"/{A,B,C,src/plugins} "$TMP"/oc/{data/opencode,state/opencode,cache,config}
: > "$TMP/zj/config.kdl"
sandbox_layout
for f in A/notes B/notes A/other A/bg A/two C/none; do print "I am $f" > "$TMP/$f.md"; done

watch= # the OpenCode pane the current step works with
fail() {
  print -u2 "FAIL: $*"
  [[ -n $watch ]] && print -u2 -- "--- the OpenCode pane ($watch) shows:"$'\n'"$(last_lines "$watch" 30)"
  exit 1
}
step() { print -- "- $*"; }
zj() { zellij --session "$S" action "$@"; }
last_lines() { zj dump-screen --pane-id "$1" 2>/dev/null | grep -v '^[[:space:]]*$' | tail -"${2:-12}"; }
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
history() { oc_cli api GET "/api/session/$1/context" 2>/dev/null; }
history_has() { history "$1" | grep -q -- "$2"; }
folder_of() { oc_cli api GET "/api/session/$1" 2>/dev/null | jq -r '.data.location.directory // empty'; }
in_folder() { [[ $(folder_of "$1") == "$2" ]]; }
cd_to() { # $1 = OpenCode pane, $2 = its conversation, $3 = folder: /cd there
  local try
  zj write-chars --pane-id "terminal_$1" "/cd $3"
  # Enter first takes the folder from the completion list, if it is open yet,
  # then runs /cd: press it until the conversation has moved.
  for try in 1 2 3; do
    sleep 1
    zj write --pane-id "terminal_$1" 13
    wait_for 5 in_folder "$2" "$3" && return 0
  done
  return 1
}
cleanup() {
  sandbox_cleanup "$S"
  rm -rf "$TMP"
}
trap cleanup EXIT

# Private OpenCode: your config, with a copy of this checkout's plugins linked in
# the way the installer links them (the stale-warning step edits the copy).
cp "$REAL/.local/share/opencode/auth.json" "$TMP/oc/data/opencode/" 2>/dev/null
cp "$REAL/.local/state/opencode/model.json" "$TMP/oc/state/opencode/" 2>/dev/null
cp -RL "$REAL/.config/opencode" "$TMP/oc/config/opencode" 2>/dev/null
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
# This checkout's ADE config (OpenCode through opencode-pane); the sandbox has
# this checkout's ade and opencode-pane first on PATH, as installed.
mkdir -p "$TMP/oc/config/ade"
cp "$ROOT/config/.config/ade/config.json" "$TMP/oc/config/ade/"
export XDG_DATA_HOME=$TMP/oc/data XDG_STATE_HOME=$TMP/oc/state XDG_CACHE_HOME=$TMP/oc/cache \
  XDG_CONFIG_HOME=$TMP/oc/config
[[ -r $REAL/.config/zsh/secrets.zsh ]] && source "$REAL/.config/zsh/secrets.zsh"
# Google's credentials (for models on Vertex AI) are found through HOME.
adc=$REAL/.config/gcloud/application_default_credentials.json
[[ -z ${GOOGLE_APPLICATION_CREDENTIALS:-} && -r $adc ]] && export GOOGLE_APPLICATION_CREDENTIALS=$adc
# The private service starts as if from a pane of the test's session, with its
# Zellij variables (the plugin must remove them), on a port of its own.
sandbox_opencode ZELLIJ=0 ZELLIJ_SESSION_NAME="$S" ZELLIJ_PANE_ID=0 || fail "the private OpenCode service did not start"

# Two projects in wt's layout, for delegate: proj, and proj2 to reach from it.
for p in proj proj2; do
  git init -q --bare "$TMP/$p.git"
  git init -q "$TMP/seed-$p" && print seed > "$TMP/seed-$p/README"
  git -C "$TMP/seed-$p" add README && git -C "$TMP/seed-$p" -c user.name=t -c user.email=t@example.com commit -qm init
  git -C "$TMP/seed-$p" push -q "$TMP/$p.git" HEAD:main && git --git-dir="$TMP/$p.git" symbolic-ref HEAD refs/heads/main
  (cd "$TMP" && ade worktree clone "$TMP/$p.git" "$p" && cd "$p" && ade worktree open --stay main) >/dev/null 2>&1
  [[ -d $TMP/$p/main ]] || fail "could not set up the wt project $p"
done

# Zellij passes this environment (sandbox, private OpenCode, this checkout's
# ade) on to its panes.
sandbox_client "$TMP/A" --config-dir "$TMP/zj" attach --create --force-run-commands "$S"
wait_for 60 session_running || fail "the test session did not start"
sandbox_dismiss_welcome "$S"

tab=$(dev_tab "$TMP/A") || exit 1
oc=$(pane opencode "$tab") ed=$(pane editor "$tab")
watch=$oc
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
cd_to "$oc" "$sid" "$TMP/B" || fail "/cd did not move the conversation to $TMP/B; it is in $(folder_of "$sid")"
type_in "$oc" 'Call the show_file tool with paths ["notes.md"]. Do nothing else.'
wait_for 30 history_has "$sid" "Call the show_file tool" || fail "the request did not reach the conversation"
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
watch=$oc_p
sid_p=$(start_conversation "$oc_p" "$TMP/proj/main")
tabs_before=$(zj list-tabs --json | jq length)
type_in "$oc_p" 'Delegate this to a new worktree named feat-x: reply with exactly the word delegated.'
wait_for 120 gives tab_in "$TMP/proj/feat-x" \
  || fail "no tab opened for the delegated worktree; panes: $(zj list-panes --json | jq -c '[.[] | select(.is_plugin == false) | {id, tab_id, title, cwd: .pane_cwd}]')"
[[ $(active_tab) == "$tab_p" ]] || fail "delegate moved you to the new tab"
(( $(zj list-tabs --json | jq length) == tabs_before + 1 )) || fail "delegate should open exactly one tab"
wait_for 120 gives newest "$TMP/proj/feat-x" || fail "the delegated tab's OpenCode did not start on the brief"
command_of() { # $1 = tab: what its opencode pane runs
  zj list-panes --json 2>/dev/null | jq -r --argjson t "$1" \
    '[.[] | select(.is_plugin == false and .tab_id == $t and .title == "opencode")][0].terminal_command // empty'
}
[[ $(command_of "$(tab_in "$TMP/proj/feat-x")") == *opencode-pane* ]] \
  || fail "the delegated tab's OpenCode should run through opencode-pane: $(command_of "$(tab_in "$TMP/proj/feat-x")")"

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
history "$copy" | grep -q copy-marker || fail "the copy lacks the conversation's history"
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
(cd "$TMP/proj/main" && ade worktree open --stay quiet >/dev/null 2>&1) || fail "could not add a worktree without a tab"
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
wait_for 120 gives tab_in "$TMP/proj2/feat-z" || fail "no tab opened in the other repository"
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
watch=$full_oc
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
watch=$oc
zj new-tab --name elsewhere >/dev/null
sleep 2
here=$(active_tab)
msg=$(show "$sid" "$TMP/A/bg.md")
wait_for 10 screen_has "$ed" "I am A/bg" || fail "Helix in the background tab did not show A/bg.md: $msg"
[[ $(active_tab) == "$here" ]] || fail "show_file switched you to another tab"

step "a background tab without Helix: nothing opens, you stay, the caller is told"
tab_c=$(dev_tab "$TMP/C" no-editor) || exit 1
oc_c=$(pane opencode "$tab_c")
watch=$oc_c
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
watch=$oc_2
screen_has "$oc_2" "show_file" || fail "the second pane is not showing the conversation"
show "$sid" "$TMP/A/two.md" >/dev/null
sleep 3
n=0
for e in "$ed" "$ed_2"; do screen_has "$e" "I am A/two" && (( n++ )); done
(( n == 1 )) || fail "$n panes opened the file"

step "a conversation no pane shows: nothing opens, and the caller is told"
watch=$oc
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
watch=$fresh
wait_for 30 screen_has "$fresh" "ADE plugin" || fail "no stale warning in a new OpenCode pane"

print "ade plugin smoke test: ok"
