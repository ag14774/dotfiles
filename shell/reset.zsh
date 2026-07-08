# reset.zsh
# zreset -- blow away the current zellij session and start fresh.
#
# With `session_name "main"` + `attach_to_session true` in config.kdl, every
# terminal attaches to the single "main" session (so all iTerm tabs share it and
# you use zellij tabs). `zreset` destroys that session so the NEXT terminal/tab
# builds a clean one from the `dev` layout.
#
# Killing the session you're attached to from inside is unreliable, so we detach
# first, then force-kill + delete it from a disowned background job that outlives
# this shell (nohup). With ZELLIJ_AUTO_EXIT the tab then closes -- open a new tab
# for a fresh "main". `delete-session --force` also wipes any serialized snapshot,
# so nothing resurrects (works whether or not session_serialization is enabled).
#
# Tip: a non-"Default" iTerm profile skips the zellij auto-start (see ~/.zshrc),
# giving you a bare shell to run session admin from if you ever need it.
zreset() {
  local s="${ZELLIJ_SESSION_NAME:-main}"
  if [[ -n "$ZELLIJ" ]]; then
    nohup zsh -c "sleep 1; zellij delete-session --force '$s'" >/dev/null 2>&1 &
    disown
    echo "zreset: wiping '$s' -- this tab will close; open a new one for a fresh session." >&2
    zellij action detach
  else
    zellij delete-session --force "$s" && echo "zreset: '$s' wiped; open a zellij terminal for a fresh session." >&2
  fi
}
