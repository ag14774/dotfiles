# git.zsh -- our git shortcuts (we don't load omz's git plugin).
# git_current_branch normally comes from omz's lib; fallback for when it doesn't.
(( $+functions[git_current_branch] )) || git_current_branch() {
  git symbolic-ref --quiet --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null
}

# Push/pull the configured upstream when one exists (including a contributor's
# fork set up by `wtchange`). New branches still default to origin and record an
# upstream so `wtprune` can later recognize a deleted remote branch. Refuse a
# detached HEAD: in particular, a `wtreview` checkout must run `wtchange` first.
ggpush() {
	emulate -L zsh
	local branch
	branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) \
		|| { print -u2 "ggpush: detached HEAD -- run wtchange or switch to a branch first"; return 1; }
	if [[ -n $(git config --get "branch.$branch.remote" 2>/dev/null) \
		&& -n $(git config --get "branch.$branch.merge" 2>/dev/null) ]]; then
		git push "$@"
	else
		git push -u origin "$branch" "$@"
	fi
}

ggpull() {
	emulate -L zsh
	local branch
	branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) \
		|| { print -u2 "ggpull: detached HEAD -- run wtchange or switch to a branch first"; return 1; }
	if [[ -n $(git config --get "branch.$branch.remote" 2>/dev/null) \
		&& -n $(git config --get "branch.$branch.merge" 2>/dev/null) ]]; then
		git pull "$@"
	else
		git pull origin "$branch" "$@"
	fi
}

# _gcai_model -- print the model a new OpenCode conversation here would start
# with, in the TUI's order: $GCAI_MODEL, a `model` set in OpenCode's config, then
# the model used most recently. Prints nothing to leave it to OpenCode's own
# default (`opencode run` alone skips the recent model, and its default is a
# free model with a usage limit).
_gcai_model() {
	if [ -n "${GCAI_MODEL:-}" ]; then
		printf '%s\n' "$GCAI_MODEL"
		return
	fi
	local dir model
	dir="$(jq -rn --arg d "$PWD" '$d | @uri')"
	model="$(opencode api get "/api/config?directory=$dir" 2>/dev/null | jq -r '
		[.[] | select(.type == "document" and .info.model != null) | .info.model] | last // empty
		| if type == "string" then . else "\(.providerID)/\(.model)" + (if .variant then "#\(.variant)" else "" end) end
	' 2>/dev/null)"
	if [ -z "$model" ]; then
		model="$(jq -r '.recent[0] // empty | select(.providerID and .modelID) | "\(.providerID)/\(.modelID)"' \
			"${XDG_STATE_HOME:-$HOME/.local/state}/opencode/model.json" 2>/dev/null)"
	fi
	[ -z "$model" ] || printf '%s\n' "$model"
}

# gcai -- draft a commit message from the staged diff via opencode, then edit in
# Helix before committing (gcai -y skips the edit). Needs staged changes + jq.
# Uses the model a new OpenCode conversation would (see _gcai_model); set
# GCAI_MODEL=provider/model in ~/.config/zsh/secrets.zsh to pick another. No
# provider is hardcoded here. For Google Vertex, export GOOGLE_CLOUD_PROJECT (and
# optionally VERTEX_LOCATION) there too -- see secrets.zsh.example.
# An optional free-text arg adds extra instructions for the prompt, e.g.
#   gcai 'mention that function X is a placeholder, implemented in a later PR'
#   gcai -y 'note this is a breaking change'
gcai() {
	local edit=1 extra="" arg
	for arg in "$@"; do
		case "$arg" in
			-y|--yes) edit=0 ;;
			*) extra="${extra:+$extra }$arg" ;;
		esac
	done

	git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { printf 'gcai: not a git repo\n' >&2; return 1; }
	command -v opencode >/dev/null 2>&1 || { printf 'gcai: opencode not found\n' >&2; return 1; }
	if git diff --cached --quiet; then
		printf "gcai: nothing staged -- run 'git add' first\n" >&2
		return 1
	fi

	local prompt='Write a git commit message for the staged git diff provided on stdin. Use Conventional Commits: a subject line "type(scope): summary" in the imperative mood, <=72 chars (scope optional); if it adds real information, a blank line then a concise body wrapped at ~72 columns explaining what and why. Output ONLY the raw commit message -- no code fences, no surrounding quotes, no preamble.'
	if [ -n "$extra" ]; then
		prompt="$prompt

Additional instructions from the user (incorporate these): $extra"
	fi

	local model events msg sid err f
	local -a model_args=()
	model="$(_gcai_model)"
	[ -z "$model" ] || model_args=(--model "$model")
	printf 'gcai: drafting commit message with %s...\n' "${model:-the default OpenCode model}" >&2
	events="$(
		{ git diff --cached --stat; echo; git diff --cached; } |
			opencode run --format json "${model_args[@]}" "$prompt" 2>/dev/null
	)"
	msg="$(jq -rj 'select(.type=="text").part.text' <<<"$events")"
	# The drafting session is disposable. Deleting it keeps it out of the session
	# list and stops restored OpenCode panes (`--continue`) from reopening it.
	sid="$(jq -r '.sessionID // empty' <<<"$events" | head -n1)"
	[ -n "$sid" ] && opencode session delete "$sid" >/dev/null 2>&1

	if [ -z "${msg//[[:space:]]/}" ]; then
		err="$(jq -r 'select(.type=="error") | (.error | if type=="object" then .message else . end) // .message // empty' \
			<<<"$events" 2>/dev/null | head -n1)"
		printf 'gcai: opencode returned no message: %s\n' "${err:-no output (check your opencode auth)}" >&2
		printf 'gcai: set GCAI_MODEL=provider/model in ~/.config/zsh/secrets.zsh to use another model\n' >&2
		return 1
	fi

	f="$(mktemp)"
	printf '%s\n' "$msg" >"$f"
	if [ "$edit" = 1 ]; then
		git commit -e -F "$f"
	else
		git commit -F "$f"
	fi
	rm -f "$f"
}
