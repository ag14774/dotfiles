# reset.zsh
# zreset: end the Zellij session you are in (outside Zellij: `main`, the one
# every terminal attaches to) and delete its saved copy, so the next terminal
# starts a fresh session from the `dev` layout instead of restoring it. Run
# from inside the session, it closes this terminal; open a new one.
#
# For a plain shell without Zellij, start zsh with ZELLIJ_AUTO_START=false.
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
  # From inside, detach first and let a background job that outlives this shell
  # end the session; the saved copy goes only once the server has exited, or
  # it could save the session again while shutting down.
  if [[ -n "$ZELLIJ" ]]; then
    nohup zsh -c "sleep 1; $wipe" zreset "$s" >/dev/null 2>&1 &
    disown
    echo "zreset: wiping '$s' -- this terminal will close; open a new one for a fresh session." >&2
    zellij action detach
  else
    zsh -c "$wipe" zreset "$s" && echo "zreset: '$s' wiped; open a new terminal for a fresh session." >&2
  fi
}
