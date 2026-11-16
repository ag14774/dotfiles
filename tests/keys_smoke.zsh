#!/usr/bin/env zsh
# ade's live check of the keys that tie the panes together (Alt-y, Helix's
# `+ a`, Alt-v), run on this checkout's Zellij, Helix, Yazi and tuicr config
# instead of ade's starter. It runs in ade's sandbox, so it never reaches your
# session.
#
#   zsh tests/keys_smoke.zsh

ROOT=${0:A:h:h}
ADE_HOME=${ADE_HOME:-$HOME/.local/share/ade}
[[ -r $ADE_HOME/tests/keys_smoke.zsh ]] || { print -u2 "no ade checkout in $ADE_HOME (install.sh makes it)"; exit 1; }
export SANDBOX_CONFIG=$ROOT/config/.config SANDBOX_BIN=$ROOT/config/.local/bin
exec zsh "$ADE_HOME/tests/keys_smoke.zsh"
