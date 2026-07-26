# reset.zsh
# zreset -- blow away the current zellij session and start fresh.
#
# The shared zsh setup starts Zellij in every terminal frontend. With
# `session_name "main"` + `attach_to_session true` in config.kdl, each frontend
# attaches to the same session. `zreset` destroys it so the NEXT terminal builds
# a clean one from the `dev` layout.
#
# Killing the session you're attached to from inside is unreliable, so we detach
# first, then force-kill + delete it from a disowned background job that outlives
# this shell (nohup). Since the outer shell execs Zellij, the terminal then
# closes; open a new one for a fresh "main". `delete-session --force` also wipes
# any serialized snapshot, so nothing resurrects (works whether or not
# session_serialization is enabled).
#
# Tip: set ZELLIJ_AUTO_START=false before launching zsh for a bare admin shell.
zreset() {
  local s="${ZELLIJ_SESSION_NAME:-main}"
  if [[ -n "$ZELLIJ" ]]; then
    nohup zsh -c "sleep 1; zellij delete-session --force '$s'" >/dev/null 2>&1 &
    disown
    echo "zreset: wiping '$s' -- this terminal will close; open a new one for a fresh session." >&2
    zellij action detach
  else
    zellij delete-session --force "$s" && echo "zreset: '$s' wiped; open a new terminal for a fresh session." >&2
  fi
}
