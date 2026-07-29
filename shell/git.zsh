# git.zsh -- our git shortcuts (we don't load omz's git plugin).
# git_current_branch normally comes from omz's lib; fallback for when it doesn't.
(( $+functions[git_current_branch] )) || git_current_branch() {
  git symbolic-ref --quiet --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null
}

# push/pull the current branch to/from origin/<same-name>.
# ggpush uses -u so the branch records its upstream (an explicit `git push origin
# <branch>` does NOT trigger push.autoSetupRemote). Without that upstream, once the
# remote branch is later merged+deleted git keeps no trace it ever existed, so
# `wtprune` can't tell the worktree from a never-pushed one.
alias ggpush='git push -u origin "$(git_current_branch)"'
alias ggpull='git pull origin "$(git_current_branch)"'

# gcai -- draft a commit message from the staged diff via opencode, then edit in
# Helix before committing (gcai -y skips the edit). Needs staged changes + jq.
# Uses whatever provider/model opencode is configured with; no provider is
# hardcoded here. If that's Google Vertex, export GOOGLE_CLOUD_PROJECT (and
# optionally VERTEX_LOCATION) in ~/.config/zsh/secrets.zsh -- see secrets.zsh.example.
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

	printf 'gcai: drafting commit message with opencode...\n' >&2
	local msg f
	msg="$(
		{ git diff --cached --stat; echo; git diff --cached; } |
			opencode run --format json "$prompt" \
				2>/dev/null | jq -rj 'select(.type=="text").part.text'
	)"

	if [ -z "${msg//[[:space:]]/}" ]; then
		printf 'gcai: opencode returned no message (check your opencode auth/model)\n' >&2
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
