# ~/dotfiles/shell/gca.zsh
# gcai -- "git commit, AI-drafted". Summarise the *staged* diff with opencode,
#         then open the draft in $EDITOR (Helix) to review/edit before committing.
#   gcai       draft -> edit in Helix -> commit (git aborts if you empty it)
#   gcai -y    draft -> commit immediately (no edit)
# Named gcai (not gca) because oh-my-zsh's git plugin already aliases `gca`.
# Needs staged changes (`git add` first), opencode, and jq.
# The Vertex project/location are taken from $GOOGLE_CLOUD_PROJECT / $VERTEX_LOCATION
# if set, else the defaults below -- scoped to the opencode call only (no global
# export, so gcloud etc. are unaffected). Change the defaults for another env.
unalias gcai 2>/dev/null # guard against any alias of the same name
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
		git commit -e -F "$f" # opens Helix with the draft + status; commits on save
	else
		git commit -F "$f"
	fi
	rm -f "$f"
}
