# tests/lib/zellij-sandbox.zsh -- sourced by the live tests (keys_smoke,
# zellij_restore_smoke, ade_plugin_smoke): Zellij, and everything a test starts
# in it, kept apart from yours.
#   - Its own ZELLIJ_SOCKET_DIR (a short folder in /tmp: socket paths may be at
#     most 103 bytes), exported before any zellij command: the test's zellij
#     commands, and those of the programs in its panes (ade, yazi-picker.sh,
#     wt-core), reach only the test's server.
#   - Its own HOME, XDG_* folders and TMPDIR: Zellij's cache, permissions and
#     log, tuicr's reviews, Helix's and Yazi's state stay in the test's folder.
#     HOME is filled like an installed checkout: ~/.config/zellij is the test's
#     Zellij config (with this checkout's layouts/dev.kdl, which Alt-t and
#     `new-tab --layout dev` read), ~/.local/bin this checkout's commands (first
#     on PATH), ~/.zshrc empty (so no new-user wizard), and Zellij has granted
#     dev.kdl's bar its permissions (so it draws, instead of a prompt nobody
#     can answer).
#   - Guards first on PATH: `zellij` runs only with this socket dir and HOME;
#     `opencode` only in this HOME with a private service port set (the default
#     port is the one your service uses). No OPENCODE_* variable is inherited.
#
#   TMP=$(mktemp -d); TMP=${TMP:A}
#   source "$ROOT/tests/lib/zellij-sandbox.zsh"
#   sandbox_init ZELLIJ_CONFIG_DIR   before any zellij command; the real HOME
#                                    stays in $SANDBOX_REAL_HOME
#   sandbox_layout                   this checkout's layouts/dev.kdl, in the test's
#                                    Zellij config, its bar loaded from the test
#                                    cache (below)
#   sandbox_config NAME...           this checkout's config/.config/NAME, copied
#                                    to ~/.config
#   sandbox_opencode [VAR=VALUE...]  start a private OpenCode service (with
#                                    these variables) on a free port, for the
#                                    XDG folders set now
#   sandbox_client DIR ZELLIJ_ARGS...
#                                    a headless client (50x200) started in DIR,
#                                    output in $TMP/client.log; text appended to
#                                    $TMP/keys becomes its keystrokes
#   sandbox_dismiss_welcome SESSION  Esc on the welcome screen a new session
#                                    shows, if it does (never Enter: that
#                                    installs Zellij.app)
#   sandbox_cleanup SESSION...       quit the sessions, stop the private service
#                                    and what is left of the sandbox's servers,
#                                    remove the socket dir

SANDBOX_ROOT=${${(%):-%x}:A:h:h:h}

# dev.kdl's bar, downloaded once per release into a cache of the tests' own
# (Zellij keeps no downloaded plugins, so a new HOME would fetch it every run);
# sets SANDBOX_BAR_URL (dev.kdl's) and SANDBOX_BAR (the local file).
sandbox_bar() {
  local cache tmp
  SANDBOX_BAR_URL=$(sed -n 's/.*plugin location="\(https:[^"]*\)".*/\1/p' "$SANDBOX_ROOT/config/.config/zellij/layouts/dev.kdl" | head -n 1)
  [[ -n $SANDBOX_BAR_URL ]] || { print -u2 "sandbox_bar: no bar URL in dev.kdl"; exit 1; }
  cache=${XDG_CACHE_HOME:-$HOME/.cache}/dotfiles-tests/zellij-plugins
  SANDBOX_BAR=$cache/${${SANDBOX_BAR_URL#https://}//\//_}
  [[ -s $SANDBOX_BAR ]] && return 0
  mkdir -p "$cache"
  tmp=$(mktemp "$cache/download.XXXXXX")
  print -u2 "sandbox_bar: downloading $SANDBOX_BAR_URL (once, into $cache)"
  if curl -fsSL -o "$tmp" "$SANDBOX_BAR_URL" && [[ $(head -c 4 "$tmp" | od -An -tx1 | tr -d ' \n') == 0061736d ]]; then
    mv "$tmp" "$SANDBOX_BAR"
  else
    rm -f "$tmp"
    print -u2 "sandbox_bar: could not download the bar (a WebAssembly file) from $SANDBOX_BAR_URL"
    exit 1
  fi
}

sandbox_init() { # $1 = the test's Zellij config folder (becomes ~/.config/zellij)
  local home bin p
  [[ -n ${TMP:-} && -d $TMP && -n ${1:-} ]] || { print -u2 "sandbox_init: needs \$TMP and a config folder"; exit 1; }
  SANDBOX_ZELLIJ_CONFIG=$1
  sandbox_bar
  # Never inherit the session, or the OpenCode, this test is started from.
  unset ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID ZELLIJ_CONFIG_DIR ZELLIJ_CONFIG_FILE ZDOTDIR
  unset -m 'OPENCODE*'
  SANDBOX_REAL_HOME=$HOME
  SANDBOX_ZELLIJ=${commands[zellij]:-}
  [[ -n $SANDBOX_ZELLIJ ]] || { print -u2 "sandbox_init: zellij is not installed"; exit 1; }
  ZELLIJ_SOCKET_DIR=$(mktemp -d /tmp/zjt.XXXXXX) || { print -u2 "sandbox_init: could not make a socket dir"; exit 1; }
  export ZELLIJ_SOCKET_DIR

  home=$TMP/home bin=$TMP/sandbox-bin
  mkdir -p "$home"/{.config,.cache,.local/bin,.local/share,.local/state} "$bin" "$TMP/tmp"
  : > "$home/.zshrc"
  ln -s "$1" "$home/.config/zellij"
  for p in "$SANDBOX_ROOT"/config/.local/bin/*(N); do ln -s "$p" "$home/.local/bin/"; done
  # Zellij's cache folder on macOS, and on Linux.
  for p in "$home/Library/Caches/org.Zellij-Contributors.Zellij" "$home/.cache/zellij"; do
    mkdir -p "$p"
    print -r -- "\"file:$SANDBOX_BAR\" {
    ReadApplicationState
    ChangeApplicationState
    RunCommands
    RunActionsAsUser
}" > "$p/permissions.kdl"
  done

  cat > "$bin/zellij" <<EOF
#!/bin/sh
# Guard (tests/lib/zellij-sandbox.zsh): zellij only in this test's sandbox.
if [ "\${ZELLIJ_SOCKET_DIR:-}" != "$ZELLIJ_SOCKET_DIR" ] || [ "\${HOME:-}" != "$home" ]; then
  echo "zellij-sandbox: refusing to run zellij outside the test's sandbox (ZELLIJ_SOCKET_DIR=\${ZELLIJ_SOCKET_DIR:-unset})" >&2
  exit 97
fi
exec "$SANDBOX_ZELLIJ" "\$@"
EOF
  if [[ -n ${commands[opencode]:-} ]]; then
    cat > "$bin/opencode" <<EOF
#!/bin/sh
# Guard (tests/lib/zellij-sandbox.zsh): OpenCode only in this test's HOME, with
# a private service port (the default port is the one your service uses).
service=\${XDG_CONFIG_HOME:-\$HOME/.config}/opencode/service.json
if [ "\${HOME:-}" != "$home" ] || { [ "\$1 \$2 \$3" != "service set port" ] && ! jq -e .port "\$service" >/dev/null 2>&1; }; then
  echo "zellij-sandbox: refusing to run opencode without a private service port in \$service" >&2
  exit 97
fi
exec "${commands[opencode]}" "\$@"
EOF
  fi
  chmod +x "$bin"/*

  export HOME=$home TMPDIR=$TMP/tmp PATH="$bin:$home/.local/bin:$PATH" \
    XDG_CONFIG_HOME=$home/.config XDG_CACHE_HOME=$home/.cache \
    XDG_DATA_HOME=$home/.local/share XDG_STATE_HOME=$home/.local/state \
    OPENCODE_DISABLE_AUTOUPDATE=true
  [[ ${commands[zellij]} == "$bin/zellij" ]] || { print -u2 "sandbox_init: the zellij guard is not first on PATH"; exit 1; }
  : > "$TMP/keys"
}

sandbox_layout() {
  mkdir -p "$SANDBOX_ZELLIJ_CONFIG/layouts"
  sed "s|plugin location=\"$SANDBOX_BAR_URL\"|plugin location=\"file:$SANDBOX_BAR\"|" \
    "$SANDBOX_ROOT/config/.config/zellij/layouts/dev.kdl" > "$SANDBOX_ZELLIJ_CONFIG/layouts/dev.kdl"
  grep -qF "file:$SANDBOX_BAR" "$SANDBOX_ZELLIJ_CONFIG/layouts/dev.kdl" \
    || { print -u2 "sandbox_layout: could not point dev.kdl's bar at $SANDBOX_BAR"; exit 1; }
}

sandbox_config() { # $@ = folders of this checkout's config/.config
  local name
  for name; do cp -R "$SANDBOX_ROOT/config/.config/$name" "$XDG_CONFIG_HOME/"; done
}

sandbox_opencode() { # $@ = VAR=VALUE for the service's environment
  local port i
  port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
  opencode service set port "$port" >/dev/null 2>&1
  SANDBOX_SERVICE=$XDG_STATE_HOME/opencode/service.json
  env "$@" opencode service start >>"$TMP/service.log" 2>&1
  for i in {1..30}; do [[ -f $SANDBOX_SERVICE ]] && return 0; sleep 1; done
  print -u2 "sandbox_opencode: the private OpenCode service did not start: $(tail -n 5 "$TMP/service.log")"
  return 1
}

sandbox_client() { # $1 = folder to start in, then zellij's arguments
  local dir=$1 cmd
  shift
  cmd="stty rows 50 cols 200; exec zellij ${(j: :)${(qq)@}}"
  # `script` needs an ordinary pipe as input (macOS rejects a FIFO).
  if script --version 2>/dev/null | grep -q util-linux; then
    (cd "$dir" && tail -n 0 -f "$TMP/keys" | env TERM=xterm-256color script -qfc "$cmd" /dev/null >>"$TMP/client.log" 2>&1 &)
  else
    (cd "$dir" && tail -n 0 -f "$TMP/keys" | env TERM=xterm-256color script -q /dev/null zsh -fc "$cmd" >>"$TMP/client.log" 2>&1 &)
  fi
}

sandbox_welcome_open() { # $1 = session: is Zellij's welcome screen (a floating plugin) open?
  zellij --session "$1" action list-panes --json 2>/dev/null \
    | jq -e '[.[] | select(.is_plugin and .is_floating and (.title | startswith("Welcome")))] | length > 0' >/dev/null
}

sandbox_dismiss_welcome() { # $1 = session
  local i
  for i in {1..20}; do sandbox_welcome_open "$1" && break; sleep 0.5; done
  sandbox_welcome_open "$1" || return 0
  print -rn -- $'\e' >> "$TMP/keys"
  for i in {1..20}; do sandbox_welcome_open "$1" || return 0; sleep 0.5; done
  print -u2 "sandbox_dismiss_welcome: the welcome screen stayed open"
}

sandbox_cleanup() { # $@ = the test's sessions
  setopt local_options no_err_exit
  local s
  # By its pid: `opencode service stop` would stop yours if the environment were lost.
  [[ -n ${SANDBOX_SERVICE:-} && -f $SANDBOX_SERVICE ]] && kill "$(jq -r .pid "$SANDBOX_SERVICE")" 2>/dev/null
  [[ ${ZELLIJ_SOCKET_DIR:-} == /tmp/zjt.* ]] || return 0
  for s; do zellij kill-session "$s" >/dev/null 2>&1; done
  pkill -f "tail -n 0 -f $TMP/keys" 2>/dev/null
  sleep 1
  pkill -f -- "--server $ZELLIJ_SOCKET_DIR/" 2>/dev/null
  rm -rf -- "$ZELLIJ_SOCKET_DIR"
}
