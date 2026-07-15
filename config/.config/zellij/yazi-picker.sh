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
# Row (Y) of the non-plugin pane named $1 in the current tab ($TAB), or empty.
pane_y() { zellij action list-panes --json 2>>"$ERRTO" | jq -r --arg n "$1" --arg t "${TAB:-}" '.[]|select(.is_plugin==false and .title==$n)|select($t=="" or ((.tab_id|tostring)==$t))|.pane_y' | head -n1; }

log "=== picker start === session=${ZELLIJ_SESSION_NAME:-<unset>}"

# Scope everything to the tab Alt-y was pressed in: the picker runs in a floating
# pane whose id is $ZELLIJ_PANE_ID; look it up to get our tab_id. This stops the
# "editor" lookup from matching a Helix running in another tab. Empty => any tab.
TAB="$(zellij action list-panes --json 2>>"$ERRTO" | jq -r --arg me "${ZELLIJ_PANE_ID:-}" '.[]|select((.id|tostring)==$me)|.tab_id' | head -n1)"
log "current tab=[$TAB] (my pane_id=${ZELLIJ_PANE_ID:-<unset>})"

chooser="$(mktemp "${TMPDIR:-/tmp}/yazi-picker.XXXXXX")"
trap 'rm -f "$chooser"' EXIT

# Persist Yazi's last directory PER PROJECT so the next Alt-y reopens where you
# left off (no re-walking deep folders for a sibling file). Key the state file by
# the git root of this tab's `main` pane (fallback: the picker's own cwd), so each
# repo/worktree remembers its own last folder. --cwd-file writes it back on exit.
projdir="$(zellij action list-panes --json 2>>"$ERRTO" | jq -r --arg t "${TAB:-}" '.[]|select(.is_plugin==false and .title=="main")|select($t=="" or ((.tab_id|tostring)==$t))|.pane_cwd' | head -n1)"
[ -n "$projdir" ] && [ -d "$projdir" ] || projdir="$PWD"
projroot="$(git -C "$projdir" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$projdir")"
projkey="$(printf '%s' "$projroot" | cksum)"
projkey="${projkey%% *}"
cwdf="$CACHE/last-cwd-$projkey"
log "project=[$projroot] cwd-state=[$cwdf]"
start=""
if [ -s "$cwdf" ]; then
	d="$(cat "$cwdf")"
	[ -d "$d" ] && start="$d"
fi

# Force Yazi's Chafa (Unicode-block) preview instead of zellij's Sixel, which is
# buggy and smears/tears on scroll (e.g. PDFs). Posing as kitty makes Yazi try
# the kitty graphics protocol, which zellij doesn't support, so it falls back to
# Chafa -- plain text cells that render + clear correctly. Yazi runs chafa with
# `-f symbols`, so this TERM doesn't make chafa emit real kitty graphics.
TERM=xterm-kitty yazi ${start:+"$start"} --chooser-file="$chooser" --cwd-file="$cwdf"
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

editor_id="$(bash "$RESOLVE" editor "$TAB" 2>>"$ERRTO")"
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
	# Spawn Helix, then snap the tab into the `with-editor` swap layout.
	#
	# Why the explicit swap: zellij only AUTO-applies a swap layout when the tab's
	# tiled layout is "clean". If it's been manually restructured -- e.g. you closed
	# opencode (Ctrl-D) and `ocreload` re-created it with `new-pane --direction
	# right` -- the tab is flagged swap-layout-dirty, so adding the editor pane no
	# longer triggers `with-editor`; the pane just gets raw-split into a flat row.
	# So: only when the editor lands WRONG (flat row, or below main) do we call
	# `next-swap-layout` to re-apply the swap (placing editor/main/opencode by NAME,
	# bars included) and clear the dirty flag; a clean auto-applied layout is left
	# untouched. The move-pane check stays as a fallback net.
	log "spawn: new-pane --close-on-exit -n editor -- hx ${files[*]}"
	# --close-on-exit: when Helix quits (:q), close the pane instead of leaving it
	# in zellij's "exited, press Enter to rerun" state. The swap layout then reflows
	# back to main|opencode.
	zellij action new-pane --close-on-exit -n editor -- hx "${files[@]}" 2>>"$ERRTO"
	eid=""
	for ((i = 0; i < 40; i++)); do
		eid="$(bash "$RESOLVE" editor "$TAB" 2>>"$ERRTO")"
		[ -n "$eid" ] && break
		sleep 0.05
	done
	log "post-spawn editor=[$eid] after $i tries"
	dump "geometry after spawn:"
	if [ -n "$eid" ]; then
		sleep 0.15 # let any auto-layout settle first
		ey="$(pane_y editor)"
		my="$(pane_y main)"
		log "positions: editor_y=$ey main_y=$my"
		# Only intervene if the editor did NOT already land on top of main. In a
		# CLEAN session zellij auto-applies `with-editor` (editor above main) and we
		# must NOT touch it -- calling next-swap-layout there would cycle it AWAY.
		# editor_y >= main_y means it's wrong: either the flat 3-column from the
		# ocreload dirty-swap bug (editor_y == main_y, side by side) or editor below
		# main. Re-apply the swap to snap panes into place by name and un-dirty.
		if [ -n "$ey" ] && [ -n "$my" ] && [ "$ey" -ge "$my" ] 2>/dev/null; then
			log "editor not on top (ey>=my) -> re-applying with-editor swap"
			zellij action next-swap-layout 2>>"$ERRTO"
			sleep 0.15
			# Fallback net for the nested (editor-below-main) case, if the swap did
			# not take: nudge the editor up so it stays the prominent pane.
			ey="$(pane_y editor)"
			my="$(pane_y main)"
			log "after swap: editor_y=$ey main_y=$my"
			if [ -n "$ey" ] && [ -n "$my" ] && [ "$ey" -gt "$my" ] 2>/dev/null; then
				zellij action move-pane --pane-id "$eid" up 2>>"$ERRTO"
				log "editor still below main -> moved up rc=$?"
			fi
		else
			log "editor already on top (or positions unknown) -> leaving as-is"
		fi
		zellij action focus-pane-id "$eid" 2>>"$ERRTO"
		dump "geometry after placement:"
	fi
fi
log "=== done ==="
