#!/usr/bin/env zsh
# Live check of the worktree plugin (packages/opencode-ade-worktrees, with
# ade-kit) in the installed OpenCode: worktrees OpenCode makes and removes
# itself, through its API as the TUI's "New worktree" and the agents'
# worktree_remove do, follow the repository's layout, get a real branch and
# seeded files, and need force when they have changes. OpenCode runs a private
# background service (its own HOME, XDG folders and port; stopped by its pid),
# with this checkout's packages; no Zellij, no model calls.

set -u

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
fail() {
  print -u2 "FAIL: $*"
  exit 1
}
step() { print -- "- $*"; }

unset -m 'OPENCODE*'
unset ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID ADE_CONFIG
OPENCODE=${commands[opencode]:-}
[[ -n $OPENCODE ]] || fail "opencode is not installed"
export HOME=$TMP/home TMPDIR=$TMP/tmp XDG_CONFIG_HOME=$TMP/home/.config XDG_DATA_HOME=$TMP/home/.local/share \
  XDG_STATE_HOME=$TMP/home/.local/state XDG_CACHE_HOME=$TMP/home/.cache OPENCODE_DISABLE_AUTOUPDATE=true
export GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
mkdir -p "$TMPDIR" "$XDG_CONFIG_HOME"/{opencode/plugins,ade} "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$TMP/src"
PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
PID=
trap '[[ -n $PID && $PID != null ]] && kill "$PID" 2>/dev/null; rm -rf "$TMP"' EXIT

# OpenCode only in this HOME, with the private port in its service config.
oc() {
  [[ $HOME == $TMP/home ]] || fail "refusing to run opencode outside the test's HOME"
  [[ "$1 $2" == "service set" || $(jq -r .port "$XDG_CONFIG_HOME/opencode/service.json" 2>/dev/null) == $PORT ]] \
    || fail "refusing to run opencode without the private port"
  "$OPENCODE" "$@"
}
api() { oc api "$@" 2>&1; } # the response body (and HTTP status line on errors)

# This checkout's packages (the plugin imports ade-kit beside it) and ADE config.
cp -R "$ROOT/packages" "$TMP/src/"
ln -s "$TMP/src/packages/opencode-ade-worktrees" "$XDG_CONFIG_HOME/opencode/plugins/ade-worktrees"
cp "$ROOT/config/.config/ade/config.json" "$XDG_CONFIG_HOME/ade/"
ade=$TMP/src/packages/ade-kit/src/cli.ts

# A project in the bare layout: main (with a .env to seed) and feat-old, made
# by wt, where a conversation will open (OpenCode then records it as its Git
# strategy's).
git init -q --bare "$TMP/origin.git"
git init -q -b main "$TMP/seed"
print '.env' > "$TMP/seed/.gitignore"
git -C "$TMP/seed" add .gitignore && git -C "$TMP/seed" commit -qm base
git -C "$TMP/seed" push -q "$TMP/origin.git" main && git --git-dir="$TMP/origin.git" symbolic-ref HEAD refs/heads/main
(cd "$TMP" && node "$ade" worktree clone "$TMP/origin.git" proj >/dev/null 2>&1) || fail "could not clone the project"
P=$TMP/proj
(cd "$P" && node "$ade" worktree open -s main >/dev/null 2>&1 && node "$ade" worktree open -s feat-old >/dev/null 2>&1) \
  || fail "could not make the project's worktrees"
print secret > "$P/main/.env"

oc service set port "$PORT" >/dev/null 2>&1
oc service start > "$TMP/service.log" 2>&1
for _ in {1..40}; do [[ -f $XDG_STATE_HOME/opencode/service.json ]] && break; sleep 1; done
PID=$(jq -r .pid "$XDG_STATE_HOME/opencode/service.json" 2>/dev/null)
[[ -n $PID && $PID != null ]] || fail "the private OpenCode service did not start: $(tail -n 5 "$TMP/service.log")"

location() { api get "/api/location?location%5Bdirectory%5D=$1"; }
project=$(location "$P/main" | jq -r .project.id)
[[ -n $project && $project != null ]] || fail "OpenCode found no project in $P/main"
location "$P/feat-old" >/dev/null
create() { api post /api/worktree -d "$(jq -cn --arg p "$project" --argjson more "$1" '{projectID: $p} + $more')"; }
removing() { api delete /api/worktree -d "$(jq -cn --arg p "$project" --arg d "$1" --argjson f "$2" '{projectID: $p, directory: $d, force: $f}')"; }
branch_of() { git -C "$1" symbolic-ref --short HEAD 2>/dev/null; }

step "a new worktree from OpenCode: wt's folder, a real branch, seeded"
out=$(create '{"name": "task-a"}')
[[ $(jq -r .directory <<< "$out" 2>/dev/null) == "$P/task-a" ]] || fail "expected $P/task-a, got: $out"
[[ $(branch_of "$P/task-a") == task-a ]] || fail "task-a should be on branch task-a"
[[ $(<"$P/task-a/.env") == secret ]] || fail "task-a should have main's .env"

step "a name with a slash keeps it in the branch; the start ref is used"
git -C "$P/main" commit -q --allow-empty -m "on main"
out=$(create '{"name": "feat/x", "branch": "main"}')
[[ $(jq -r .directory <<< "$out" 2>/dev/null) == "$P/feat-x" ]] || fail "expected $P/feat-x, got: $out"
[[ $(branch_of "$P/feat-x") == feat/x ]] || fail "feat-x should be on branch feat/x"
[[ $(git -C "$P/feat-x" rev-parse HEAD) == $(git -C "$P/main" rev-parse HEAD) ]] || fail "feat/x should start at main"

step "without a name: OpenCode's random one, as folder and branch"
out=$(create '{}')
dir=$(jq -r .directory <<< "$out" 2>/dev/null)
[[ $dir == "$P/"* && -d $dir && $(branch_of "$dir") == ${dir:t} ]] || fail "unexpected random worktree: $out"

step "OpenCode lists them all after a refresh"
api post /api/worktree/refresh -d "{\"projectID\":\"$project\"}" >/dev/null
listed=$(api get "/api/worktree?projectID=$project")
for d in task-a feat-x feat-old main; do
  [[ $(jq -r --arg d "$P/$d" '.[] | select(.directory == $d) | .strategy' <<< "$listed") == git ]] \
    || fail "$P/$d should be listed as the git strategy's: $listed"
done

step "removing: a clean worktree goes; one with changes needs force"
out=$(removing "$P/task-a" false)
[[ ! -d $P/task-a ]] || fail "task-a should be removed: $out"
print draft > "$P/feat-old/notes.md"
out=$(removing "$P/feat-old" false)
[[ $(jq -r .data.forceRequired <<< "${out%%$'\n'HTTP*}" 2>/dev/null) == true && -d $P/feat-old ]] \
  || fail "removing feat-old with changes should ask for force: $out"
out=$(removing "$P/feat-old" true)
[[ ! -d $P/feat-old ]] || fail "feat-old should be removed with force: $out"
git -C "$P" show-ref -q --verify refs/heads/feat-old || fail "the branch should stay (as with wtrm)"

print "opencode worktrees smoke test: ok"
