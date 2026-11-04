#!/bin/sh
# ~/.config/zellij/resurrect-command.sh -- Zellij's post_command_discovery_hook.
#
# Zellij serializes the session (every 60 s by default) so it can be resurrected.
# For each pane running a program started from its shell, it passes that command
# here as $RESURRECT_COMMAND (words joined by spaces) and saves whatever this
# prints instead. Printing nothing keeps the pane's original command (a plain
# shell for ordinary panes). Zellij splits the output on whitespace, so it must
# not rely on quoting. Panes started with a program, such as opencode-pane, are
# saved with their own command line and never reach this.
#
# config.kdl sources this in Zellij's own `sh` (`list-panes` runs it too and
# waits only 100 ms), so it must stay POSIX sh, cheap, and never `exit`.
#
# Resurrected sessions run their commands immediately (the autostart attaches
# with --force-run-commands), so only commands that are safe to rerun pass:
#   opencode (the TUI)  -> opencode-pane --resume (continue this directory's session)
#   hx / helix          -> unchanged (reopens the same files)
#   anything else       -> nothing (git log, dev servers, rm ... are not rerun)
set -fu

# shellcheck disable=SC2086 # split the joined command into words on purpose
set -- ${RESURRECT_COMMAND:-}
command=${1-}
case "${command##*/}" in
  opencode)
    # The TUI has no subcommand; `opencode run`, `opencode api` ... are not rerun.
    case "${2-}" in
      "" | -*) printf '%s\n' "$HOME/.local/bin/opencode-pane --resume" ;;
    esac
    ;;
  hx | helix) printf '%s\n' "$RESURRECT_COMMAND" ;;
esac
