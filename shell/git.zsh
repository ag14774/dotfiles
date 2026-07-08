# git.zsh -- our git shortcuts (we don't load omz's git plugin).
# git_current_branch normally comes from omz's lib; fallback for when it doesn't.
(( $+functions[git_current_branch] )) || git_current_branch() {
  git symbolic-ref --quiet --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null
}

# push/pull the current branch to/from origin/<same-name>
alias ggpush='git push origin "$(git_current_branch)"'
alias ggpull='git pull origin "$(git_current_branch)"'

# gcai -- draft a commit message from the staged diff via opencode, then edit in
# Helix before committing (gcai -y skips the edit). Needs staged changes + jq.
gcai() {
	local edit=1
	if [ "$1" = "-y" ] || [ "$1" = "--yes" ]; then edit=0; fi

	git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { printf 'gcai: not a git repo\n' >&2; return 1; }
	command -v opencode >/dev/null 2>&1 || { printf 'gcai: opencode not found\n' >&2; return 1; }
	if git diff --cached --quiet; then
		printf "gcai: nothing staged -- run 'git add' first\n" >&2
		return 1
	fi

	printf 'gcai: drafting commit message with opencode...\n' >&2
	local msg f
	msg="$(
		{ git diff --cached --stat; echo; git diff --cached; } |
			GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-your-gcp-project-id}" \
				VERTEX_LOCATION="${VERTEX_LOCATION:-global}" \
				opencode run --format json \
				'Write a git commit message for the staged git diff provided on stdin. Use Conventional Commits: a subject line "type(scope): summary" in the imperative mood, <=72 chars (scope optional); if it adds real information, a blank line then a concise body wrapped at ~72 columns explaining what and why. Output ONLY the raw commit message -- no code fences, no surrounding quotes, no preamble.' \
				2>/dev/null | jq -rj 'select(.type=="text").part.text'
	)"

	if [ -z "${msg//[[:space:]]/}" ]; then
		printf 'gcai: opencode returned no message (check your Vertex env / auth)\n' >&2
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
