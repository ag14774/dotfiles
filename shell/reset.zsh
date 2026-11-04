# reset.zsh
# zreset -- blow away the current zellij session and start fresh.
#
# The shared zsh setup starts Zellij in every terminal frontend, and each one
# attaches to the same session, `main` (see the autostart in ~/.zshrc and
# config.kdl). `zreset` destroys it, including the copy saved for session
# resurrection, so the NEXT terminal builds a clean one from the `dev` layout.
#
# Killing the session you're attached to from inside is unreliable, so we detach
# first, then wipe it from a disowned background job that outlives this shell
# (nohup). The outer shell exits when Zellij does, so the terminal then closes;
# open a new one for a fresh "main". The job kills the session, waits for its
# server to exit, and only then deletes the saved copy: deleting it while the
# server shuts down can let the server save it again.
#
# Tip: set ZELLIJ_AUTO_START=false before launching zsh for a bare admin shell.
zreset() {
  local s="${ZELLIJ_SESSION_NAME:-main}"
  # shellcheck disable=SC2016 # expanded by the zsh -c below
  local wipe='s=$1
    zellij kill-session "$s" >/dev/null 2>&1
    for i in {1..50}; do
      zellij list-sessions --no-formatting 2>/dev/null | grep "^$s " | grep -qv EXITED || break
      sleep 0.2
    done
    zellij delete-session --force "$s" >/dev/null 2>&1 || true  # none saved yet'
  if [[ -n "$ZELLIJ" ]]; then
    nohup zsh -c "sleep 1; $wipe" zreset "$s" >/dev/null 2>&1 &
    disown
    echo "zreset: wiping '$s' -- this terminal will close; open a new one for a fresh session." >&2
    zellij action detach
  else
    zsh -c "$wipe" zreset "$s" && echo "zreset: '$s' wiped; open a new terminal for a fresh session." >&2
  fi
}
