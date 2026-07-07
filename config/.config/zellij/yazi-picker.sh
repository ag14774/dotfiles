#!/usr/bin/env bash
# ~/.config/zellij/yazi-picker.sh
#
# Alt-y summons this in a floating pane. Yazi runs as a chooser; the picked
# file(s) are routed into the named "editor" (Helix) pane, or a new one is
# spawned. Placement uses zellij's swap layout (which drops the new pane in the
# BOTTOM slot), so we move it up to the top 70% -- but only if it actually landed
# below the terminal (idempotent). Panes are resolved by NAME via pane-id.sh.
#
# Debug: `touch ~/.cache/yazi-picker/DEBUG` to log to last-run.log; `rm` to silence.
set -u

# fzf's file-list config for Yazi's `z` (respect .gitignore; Alt-g toggles all>).
# Sourced here because Alt-y runs this via `bash -c` with the zellij *session*
# env, which predates ~/.zshrc's exports (zellij auto-starts before they run).
# This guarantees Yazi's fzf sees them even in a pre-existing session.
[ -f "$HOME/.config/fzf/fzf.env" ] && . "$HOME/.config/fzf/fzf.env"

RESOLVE="$HOME/.config/zellij/pane-id.sh"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/yazi-picker"
mkdir -p "$CACHE"
LOG="$CACHE/last-run.log"

DEBUG=0
[ -f "$CACHE/DEBUG" ] && DEBUG=1
if [ "$DEBUG" = 1 ]; then
	: >"$LOG"
	ERRTO="$LOG"
else
	ERRTO=/dev/null
fi
log() {
	[ "$DEBUG" = 1 ] || return 0
	printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOG"
}
dump() {
	[ "$DEBUG" = 1 ] || return 0
	log "$1"
	zellij action list-panes -c -g 2>>"$ERRTO" >>"$LOG"
}
# Row (Y) of the non-plugin pane named $1, or empty if not found.
pane_y() { zellij action list-panes --json 2>>"$ERRTO" | jq -r --arg n "$1" '.[]|select(.is_plugin==false and .title==$n)|.pane_y' | head -n1; }

log "=== picker start === session=${ZELLIJ_SESSION_NAME:-<unset>}"

chooser="$(mktemp "${TMPDIR:-/tmp}/yazi-picker.XXXXXX")"
trap 'rm -f "$chooser"' EXIT

# Force Yazi's Chafa (Unicode-block) preview instead of zellij's Sixel, which is
# buggy and smears/tears on scroll (e.g. PDFs). Posing as kitty makes Yazi try
# the kitty graphics protocol, which zellij doesn't support, so it falls back to
# Chafa -- plain text cells that render + clear correctly. Yazi runs chafa with
# `-f symbols`, so this TERM doesn't make chafa emit real kitty graphics.
TERM=xterm-kitty yazi --chooser-file="$chooser"
log "chooser: [$(cat "$chooser" 2>/dev/null)]"
[ -s "$chooser" ] || {
	log "no selection -> exit"
	exit 0
}

files=()
while IFS= read -r line || [ -n "$line" ]; do
	[ -n "$line" ] && files+=("$line")
done <"$chooser"
[ "${#files[@]}" -gt 0 ] || {
	log "empty -> exit"
	exit 0
}
log "files: ${files[*]}"

editor_id="$(bash "$RESOLVE" editor 2>>"$ERRTO")"
log "resolved editor=[$editor_id]"

if [ -n "$editor_id" ]; then
	# Route into the existing Helix instance.
	log "route into $editor_id"
	zellij action write --pane-id "$editor_id" 27 2>>"$ERRTO" # Esc -> normal mode
	for f in "${files[@]}"; do
		zellij action write-chars --pane-id "$editor_id" ":open \"$f\"" 2>>"$ERRTO"
		zellij action write --pane-id "$editor_id" 13 2>>"$ERRTO" # Enter
	done
	zellij action focus-pane-id "$editor_id" 2>>"$ERRTO"
else
	# Spawn Helix. New panes land in the BOTTOM slot (existing panes fill earlier
	# slots, by order not by name), so flip it to the top -- but only if needed.
	log "spawn: new-pane --close-on-exit -n editor -- hx ${files[*]}"
	# --close-on-exit: when Helix quits (:q), close the pane instead of leaving it
	# in zellij's "exited, press Enter to rerun" state. The swap layout then reflows
	# back to main|opencode.
	zellij action new-pane --close-on-exit -n editor -- hx "${files[@]}" 2>>"$ERRTO"
	eid=""
	for ((i = 0; i < 40; i++)); do
		eid="$(bash "$RESOLVE" editor 2>>"$ERRTO")"
		[ -n "$eid" ] && break
		sleep 0.05
	done
	log "post-spawn editor=[$eid] after $i tries"
	dump "geometry after spawn:"
	if [ -n "$eid" ]; then
		sleep 0.15 # let the swap finish positioning
		ey="$(pane_y editor)"
		my="$(pane_y main)"
		log "positions: editor_y=$ey main_y=$my"
		if [ -n "$ey" ] && [ -n "$my" ] && [ "$ey" -gt "$my" ] 2>/dev/null; then
			zellij action move-pane --pane-id "$eid" up 2>>"$ERRTO"
			log "editor was below main -> moved up rc=$?"
		else
			log "editor already on top (or positions unknown) -> no move"
		fi
		zellij action focus-pane-id "$eid" 2>>"$ERRTO"
		dump "geometry after move:"
	fi
fi
log "=== done ==="
