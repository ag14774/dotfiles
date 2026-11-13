#!/usr/bin/env zsh
# End-to-end check of Zellij session restore against the Zellij, Helix and
# OpenCode installed on this machine. The restore depends on how they behave, so
# run it after upgrading any of them:
#
#   zsh tests/zellij_restore_smoke.zsh
#
# It drives a throwaway session through a headless terminal, in a sandbox
# (tests/lib/zellij-sandbox.zsh): its own Zellij server, HOME and config, so it
# never reaches your session and leaves nothing in your Zellij cache. It uses
# this checkout's Zellij config and hook with a 1-second save interval, and
# this checkout's commands (opencode-pane) as installed. OpenCode runs against
# a private service with an empty config; no model is called.

set -eu

ROOT=${0:A:h:h}
fail() {
  print -u2 "FAIL: $*"
  exit 1
}
step() { print -r -- "- $*"; }

HELIX=${commands[hx]:-${commands[helix]:-}}
for tool in zellij jq script tail opencode python3; do
  (( $+commands[$tool] )) || fail "$tool is not installed"
done
[[ -n $HELIX ]] || fail "Helix (hx or helix) is not installed"

TMP=$(mktemp -d)
TMP=${TMP:A}
session=dotfiles-smoke-$$
cfg=$TMP/zellij
source "$ROOT/tests/lib/zellij-sandbox.zsh"
sandbox_init "$cfg"
cleanup() {
  sandbox_cleanup "$session"
  rm -rf "$TMP"
}
trap cleanup EXIT

# This checkout's config, saving every second and using this checkout's hook.
mkdir -p "$cfg/layouts"
cp "$ROOT/config/.config/zellij/layouts/dev.kdl" "$cfg/layouts/"
sed "s|\$HOME/.config/zellij/resurrect-command.sh|$ROOT/config/.config/zellij/resurrect-command.sh|" \
  "$ROOT/config/.config/zellij/config.kdl" > "$cfg/config.kdl"
grep -q "$ROOT/config/.config/zellij/resurrect-command.sh" "$cfg/config.kdl" \
  || fail "could not point the test config at this checkout's hook"
print 'serialization_interval 1' >> "$cfg/config.kdl"
# This checkout's ADE config with the default tab names (checked below).
jq 'del(.zellij.tabName)' "$ROOT/config/.config/ade/config.json" > "$TMP/ade.json"
export ADE_CONFIG=$TMP/ade.json
sandbox_config helix
# The OpenCode panes' service: private, on a port of its own.
sandbox_opencode || fail "no private OpenCode service"

# A repository in the worktree layout.
git init -q --bare "$TMP/origin.git"
git init -q "$TMP/seed"
print notes > "$TMP/seed/notes.md"
print other > "$TMP/seed/other.md"
git -C "$TMP/seed" add notes.md other.md
git -C "$TMP/seed" -c user.name=t -c user.email=t@t commit -qm init
git -C "$TMP/seed" branch -M main
git -C "$TMP/seed" push -q "$TMP/origin.git" main
git --git-dir="$TMP/origin.git" symbolic-ref HEAD refs/heads/main
(cd "$TMP" && "$ROOT/config/.local/bin/wt-core" clone "$TMP/origin.git" proj >/dev/null 2>&1)
(cd "$TMP/proj" && "$ROOT/config/.local/bin/wt-core" open main >/dev/null 2>&1)
main=$TMP/proj/main

# A headless client; text appended to $TMP/keys becomes keystrokes.
start_client() { sandbox_client "$main" --config-dir "$cfg" attach --create --force-run-commands "$session"; }
press() { print -rn -- "$1" >> "$TMP/keys"; }

zj() { zellij --session "$session" action "$@"; }
in_session() { ZELLIJ=0 ZELLIJ_SESSION_NAME=$session "$@"; }
session_running() { zellij list-sessions --no-formatting 2>/dev/null | grep "^$session " | grep -qv EXITED; }
panes() { zj list-panes --json 2>/dev/null || print '[]'; }
pane_field() { # $1=tab ID $2=pane title $3=jq expression on that pane (null if none)
  panes | jq -r --argjson tab "$1" --arg title "$2" \
    "[.[] | select(.is_plugin == false and .tab_id == \$tab and .title == \$title)] | first | if . == null then null else $3 end"
}
running() { [[ $(pane_field "$1" "$2" '(.exited or .is_held) | not') == true ]]; }
# $1=tab ID: the editor pane is above the main pane (dev.kdl's with-editor
# swap layout; since Zellij 0.46 the editor first lands below and is moved up).
editor_on_top() { (( $(pane_field "$1" editor '.pane_y') < $(pane_field "$1" main '.pane_y') )); }
tab_in() { panes | jq -r --arg d "$1" '[.[] | select(.pane_cwd == $d)] | first | .tab_id'; }
tab_count() { zj list-tabs --json 2>/dev/null | jq length; }
wait_for() { # $1=seconds, then a command to retry until it succeeds
  local deadline=$(( SECONDS + $1 ))
  shift
  until "$@" >/dev/null 2>&1; do
    (( SECONDS < deadline )) || return 1
    sleep 0.3
  done
}
value_of() { # $1=seconds, then a command; print its first non-empty, non-null output
  local deadline=$(( SECONDS + $1 )) value
  shift
  while true; do
    value=$("$@" 2>/dev/null) || value=
    [[ -n $value && $value != null ]] && { print -r -- "$value"; return 0; }
    (( SECONDS < deadline )) || return 1
    sleep 0.3
  done
}
saved_layout() { # the saved session's folder is named by an ID (by its name before 0.46)
  local d
  for d in {${XDG_CACHE_HOME:-$HOME/.cache}/zellij,$HOME/Library/Caches/org.Zellij-Contributors.Zellij}/*/session_info/*(N/); do
    [[ -f $d/session-layout.kdl && $(head -n 1 "$d/session-metadata.kdl" 2>/dev/null) == "name \"$session\"" ]] || continue
    print -r -- "$d/session-layout.kdl"
    return 0
  done
  return 1
}
saved_has() { local f; f=$(saved_layout) && grep -q -- "$1" "$f"; }
saved_resumes() { # $1=count: OpenCode panes saved to resume their conversation
  local f
  f=$(saved_layout) && (( $(grep -o -- '"--resume"' "$f" | wc -l) >= $1 ))
}
saved_opencode() { local f; f=$(saved_layout) && grep -n -A2 'opencode' "$f" | sed "s|$HOME|~|g" | head -20; }
client_log() { sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g' "$TMP/client.log" 2>/dev/null | tr -cd '[:print:]\n' | grep -v '^ *$' | tail -5; }

step "start a session with the dev layout"
start_client
wait_for 60 session_running || fail "the test session did not start: $(client_log)"
sandbox_dismiss_welcome "$session"
wait_for 60 running 0 opencode || fail "the new session did not start OpenCode"

step "open a worktree tab, a long command in a shell, and a file in Helix"
out=$(cd "$main" && in_session "$ROOT/config/.local/bin/wt-core" open -b feat 2>&1) || fail "wt -b failed: $out"
feat_tab=$(value_of 30 tab_in "$TMP/proj/feat") \
  || fail "wt -b did not open a tab in the worktree ($out): $(panes | jq -c '[.[] | {tab_id, title, pane_cwd}]')"
tab_info() { zj list-tabs --json 2>/dev/null | jq -r --argjson t "$feat_tab" '.[] | select(.tab_id == $t) | [.name, .active] | join(" ")'; }
[[ $(tab_info) == "feat false" ]] || fail "wt -b should open a background tab named feat: $(tab_info)"
main_pane=$(value_of 30 pane_field 0 main '.id') || fail "no main pane in tab 0"
# The command first: Zellij saves only changes, so the save that records the
# editor's file (waited for below) is one that saw the command running.
zj write-chars --pane-id "terminal_$main_pane" 'sleep 9131'
zj write --pane-id "terminal_$main_pane" 13
wait_for 10 pgrep -fx 'sleep 9131' || fail "the shell did not start the long command"
(cd "$main" && in_session env ZELLIJ_PANE_ID="$main_pane" "$ROOT/config/.local/bin/hx-open" notes.md) \
  || fail "hx-open could not open a file"
wait_for 30 running 0 editor || fail "hx-open did not start Helix"
wait_for 10 editor_on_top 0 \
  || fail "the new editor pane is not above main: $(panes | jq -c '[.[] | select(.is_plugin == false and .tab_id == 0) | {title, pane_y}]')"

step "the saved layout restores Helix and OpenCode, not the shell's command"
wait_for 60 saved_has notes.md || fail "the session was not saved with the editor's file"
wait_for 90 saved_resumes 2 \
  || fail "the OpenCode panes were not saved as opencode-pane --resume:"$'\n'"$(saved_opencode)"
saved_has 'sleep 9131' && fail "the shell's long command was saved to be rerun"

step "kill and restore the session"
zellij kill-session "$session" >/dev/null 2>&1
pkill -f "tail -n 0 -f $TMP/keys" 2>/dev/null || true
wait_for 30 sh -c "zellij list-sessions --no-formatting 2>/dev/null | grep -q '^$session .*EXITED'" \
  || fail "the killed session is not listed as restorable"
start_client
wait_for 60 session_running || fail "the session was not restored: $(client_log)"
wait_for 60 running 0 opencode || fail "the restored session did not start OpenCode"
wait_for 30 running "$feat_tab" opencode || fail "the restored worktree tab did not start OpenCode"
wait_for 30 running 0 editor || fail "the restored editor pane is not running"
[[ $(pane_field "$feat_tab" opencode '.terminal_command') == *'opencode-pane --resume'* ]] \
  || fail "the restored OpenCode pane does not resume its conversation"
pgrep -f "$main/notes.md" >/dev/null || fail "the restored Helix did not reopen its file"
pgrep -fx 'sleep 9131' >/dev/null && fail "the shell's long command was rerun"
cwd_is() { [[ $(pane_field "$1" "$2" '.pane_cwd') == "$3" ]]; }
wait_for 30 cwd_is 0 main "$main" || fail "the restored shell is not in its directory"

step "wt -t finds the restored worktree tab"
before=$(tab_count)
(cd "$main" && in_session "$ROOT/config/.local/bin/wt-core" open -t feat >/dev/null 2>&1) || fail "wt -t failed"
[[ $(tab_count) == "$before" ]] || fail "wt -t opened a duplicate of the restored tab"

step "Alt-t in the restored session opens a running dev tab"
before=$(tab_count)
press $'\et'
wait_for 30 sh -c "[ \"\$(zellij --session '$session' action list-tabs --json | jq length)\" -gt $before ]" \
  || fail "Alt-t did not open a tab"
new_tab=$(zj list-tabs --json | jq -r 'max_by(.position) | .tab_id')
wait_for 30 running "$new_tab" opencode || fail "OpenCode in the Alt-t tab is suspended or missing"

step "Alt-y after quitting the restored Helix starts a fresh one"
# Pane IDs change when a session is restored.
main_pane=$(value_of 30 pane_field 0 main '.id') || fail "no main pane in the restored tab 0"
editor=$(value_of 30 pane_field 0 editor '.id') || fail "no editor pane in tab 0"
zj write --pane-id "terminal_$editor" 27
zj write-chars --pane-id "terminal_$editor" ':q!'
zj write --pane-id "terminal_$editor" 13
wait_for 30 sh -c "! zellij --session '$session' action list-panes --json | jq -e '.[] | select(.id == $editor and .is_plugin == false) | (.exited or .is_held) | not' >/dev/null" \
  || fail "quitting the restored Helix did not stop its pane"
if [[ $(panes | jq --argjson id "$editor" '[.[] | select(.id == $id and .is_plugin == false)] | length') == 0 ]]; then
  print "  (the restored editor pane closed when Helix quit)"
else
  print "  (the restored editor pane stayed open, stopped)"
fi
# Alt-y runs in the tab you are on, and Alt-t moved you to a new one (hx-open
# never switches you to another tab).
zj go-to-tab-by-id 0
(cd "$main" && in_session env ZELLIJ_PANE_ID="$main_pane" "$ROOT/config/.local/bin/hx-open" other.md) \
  || fail "hx-open failed on a stopped editor pane"
wait_for 30 running 0 editor \
  || fail "hx-open did not restart Helix in the editor pane: $(panes | jq -c '[.[] | select(.title == "editor") | {id, tab_id, exited, is_held, terminal_command}]')"
[[ $(panes | jq '[.[] | select(.is_plugin == false and .tab_id == 0 and .title == "editor")] | length') == 1 ]] \
  || fail "hx-open left more than one editor pane"
pgrep -f "$main/other.md" >/dev/null || fail "the restarted Helix did not open the file"
wait_for 10 editor_on_top 0 || fail "the restarted editor pane is not above main"

print "zellij restore smoke test: ok"
