#!/usr/bin/env zsh
# Live check that OpenCode's attention alerts (sounds and system notifications)
# for a conversation come from the OpenCode app showing it, once, with this
# checkout's status plugin (packages/opencode-ade-status) and the installed
# OpenCode. Two apps on one private service each show a conversation; one
# conversation asks a question (a form, through the API: no model calls).
#   - With OpenCode's own attention plugin on, both apps alert (OpenCode's
#     behaviour, the reason for the status plugin's), and the plugin adds none.
#   - With it off ("-opencode.notifications" in cli.json), only the app
#     showing the conversation alerts, through the status plugin: in apps
#     that were running when it was switched off, and in apps started then.
# Alerts are counted as the system notifications the apps send their terminal
# (OSC 777, chosen with OPENTUI_NOTIFICATION_PROTOCOL; they come with the
# sound, from the same call); sounds stay off, so the test is silent. The apps
# run without Zellij, each in a pseudo-terminal that answers like a terminal,
# in a sandbox (tests/lib/zellij-sandbox.zsh: its own HOME and OpenCode
# service, on a port of its own).

set -u

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
source "$ROOT/tests/lib/zellij-sandbox.zsh"
sandbox_init "$TMP/zj"

fail() {
  print -u2 "FAIL: $*"
  for app in A B; do [[ -f $TMP/app-$app.log ]] && print -u2 -- "--- app $app wrote $(wc -c < "$TMP/app-$app.log") bytes"; done
  exit 1
}
stop_apps() { # by their conversations, which only this test's service has
  pkill -f "tail -n 0 -f $TMP/keys-" 2>/dev/null
  [[ -n ${A:-} ]] && pkill -f -- "--session $A" 2>/dev/null
  [[ -n ${B:-} ]] && pkill -f -- "--session $B" 2>/dev/null
  sleep 2
}
step() { print -- "- $*"; }
cleanup() {
  stop_apps
  sandbox_cleanup
  rm -rf "$TMP"
}
trap cleanup EXIT

config=$XDG_CONFIG_HOME/opencode
mkdir -p "$config/plugins" "$TMP/A" "$TMP/B"
ln -s "$ROOT/packages/opencode-ade-status" "$config/plugins/ade-status"
sandbox_opencode || fail "the private OpenCode service did not start"

conversation() { # $1 = folder: a new conversation's ID
  opencode api post /api/session -d "$(jq -cn --arg d "$1" '{location: {directory: $d}, title: ("in " + ($d | split("/") | last))}')" \
    2>/dev/null | jq -r '.id // .data.id // empty'
}
A=$(conversation "$TMP/A")
B=$(conversation "$TMP/B")
[[ $A == ses* && $B == ses* ]] || fail "could not create the conversations"

# OpenCode notifies only while its terminal isn't focused, which it learns from
# focus reports: each app gets a focus-out report once it has turned them on.
apps() { # $1 = cli.json's plugins: two apps, A showing conversation A and B showing B
  local app sid
  stop_apps
  rm -f "$TMP"/app-A.log "$TMP"/app-B.log
  jq -n --argjson p "$1" '{plugins: $p}' > "$config/cli.json"
  for app sid in A $A B $B; do
    : > "$TMP/keys-$app"
    : > "$TMP/app-$app.log"
    (cd "$TMP/$app" && tail -n 0 -f "$TMP/keys-$app" \
      | env TERM=xterm-256color OPENTUI_NOTIFICATIONS=on OPENTUI_NOTIFICATION_PROTOCOL=osc777 OPENCODE_CLI_CONFIG_CONTENT='{"attention":{"notifications":true,"sound":false}}' \
        script -q /dev/null zsh -fc "stty rows 40 cols 120; exec opencode --session $sid" >"$TMP/app-$app.log" 2>&1 &)
  done
  # As a terminal answers the app's questions once it asks them: focus reports
  # supported (DECRPM for mode 1004), then the device attributes that end them.
  for app in A B; do
    for _ in {1..300}; do LC_ALL=C grep -a -q -F $'\e[?1004$p' "$TMP/app-$app.log" && break; sleep 0.1; done
    printf '\e[?1004;2$y\e[?62;22c' >> "$TMP/keys-$app"
  done
  sleep 10
  for app in A B; do
    LC_ALL=C grep -a -q -F $'\e[?1004h' "$TMP/app-$app.log" || fail "app $app did not turn on focus reports"
    printf '\e[O' >> "$TMP/keys-$app"
  done
  sleep 2
}
alerts() { LC_ALL=C grep -a -o -F $'\e]777;notify;' "$TMP/app-$1.log" | wc -l | tr -d ' '; }
ask() { # $1 = conversation: it asks a question (a form, as tools do)
  opencode api post "/api/session/$1/form" -d '{"title":"Continue?","fields":[{"key":"ok","type":"boolean"}]}' \
    2>/dev/null | jq -e '.data.id' >/dev/null || fail "could not ask in $1"
  sleep 5
}

step "with OpenCode's attention plugin on, every app alerts for a conversation (the plugin adds nothing)"
apps '["-opencode.btw"]'
ask "$A"
a=$(alerts A) b=$(alerts B)
[[ $a == 1 && $b == 1 ]] || fail "expected one alert in each app, got A=$a B=$b"

step "switched off while the apps run (as the installer does), at once: only the app showing it alerts"
jq -n '{plugins: ["-opencode.btw", "-opencode.notifications"]}' > "$config/cli.json"
sleep 8
ask "$A"
a=$(( $(alerts A) - a )) b=$(( $(alerts B) - b ))
[[ $a == 1 && $b == 0 ]] || fail "expected one more alert in app A and none in B, got A=+$a B=+$b"

step "apps started with it off: only the app showing the conversation alerts, once"
apps '["-opencode.btw", "-opencode.notifications"]'
ask "$A"
a=$(alerts A) b=$(alerts B)
[[ $a == 1 && $b == 0 ]] || fail "expected one alert in app A and none in B, got A=$a B=$b"

print "opencode attention smoke test: ok"
