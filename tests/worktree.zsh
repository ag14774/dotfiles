#!/usr/bin/env zsh

set -eu

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
trap 'rm -rf "$TMP"' EXIT
# Tab tests set these against a fake zellij; never touch a real session. Run
# as a person would, even from an OpenCode agent.
unset ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID OPENCODE_TERMINAL

fail() {
  print -u2 "FAIL: $*"
  exit 1
}

assert_eq() {
  [[ $1 == $2 ]] || fail "expected '$2', got '$1'"
}

core() { # `ade worktree` with these arguments: stdout in $out, stderr in $TMP/err
  out=$("$ROOT/config/.local/bin/ade" worktree "$@" 2>"$TMP/err")
}
said() { grep -qxF -- "$1" "$TMP/err" || fail "expected the message '$1', got: $(<"$TMP/err")"; }

mkdir -p "$TMP/bin" "$TMP/acme"
# Stand-in for gh: `gh pr list` (wtprune -m) answers with GH_PR_NUMBER when
# GH_PR_STATE is MERGED.
cat > "$TMP/bin/gh" <<'EOF'
#!/usr/bin/env zsh
if [[ $1 == pr && $2 == list ]]; then
  # With GH_MERGED_OID set, only the branch whose tip it is matches (like the
  # --jq filter on the exact head SHA).
  [[ $GH_PR_STATE == MERGED && ( -z ${GH_MERGED_OID:-} || " $* " == *"$GH_MERGED_OID"* ) ]] \
    && print -r -- "$GH_PR_NUMBER"
else
  exit 1
fi
EOF
chmod +x "$TMP/bin/gh"

# Stand-in for the `zellij action` calls ade makes. State lives in $ZJ_STATE:
# tabs (id, name), panes (id, tab, title, cwd, command[, "exited"]) and the
# focused tab. An empty cwd is a pane for which Zellij reports no directory.
# Each call is appended to $ZJ_STATE/log; ZJ_FAIL names a command that fails,
# and with ZJ_NO_AGENT set, new tabs have no opencode pane.
cat > "$TMP/bin/zellij" <<'EOF'
#!/usr/bin/env zsh
st=$ZJ_STATE
# Like Zellij, fail for a session other than the one these panes belong to.
if [[ $1 == --session ]]; then
  [[ $2 == ${ZELLIJ_SESSION_NAME:-} ]] || { print -u2 "Session '$2' not found"; exit 1; }
  shift 2
fi
[[ $1 == action ]] || exit 1
cmd=$2
shift 2
print -r -- "$cmd $*" >> $st/log
[[ $cmd == ${ZJ_FAIL:-} ]] && { print -u2 "$cmd failed"; exit 1; }
next_id() { local n=$(<$st/next); print $(( n + 1 )) > $st/next; print $n; }
case $cmd in
  new-tab)
    name= cwd=$PWD focus=1
    while (( $# )); do
      case $1 in -n | --name) name=$2; shift ;; --cwd) cwd=$2; shift ;; --no-focus) focus=0 ;; esac
      shift
    done
    tab=$(next_id)
    printf '%s\t%s\n' $tab $name >> $st/tabs
    printf '%s\t%s\tmain\t%s\t-\n' $(next_id) $tab $cwd >> $st/panes
    [[ -n ${ZJ_NO_AGENT:-} ]] \
      || printf '%s\t%s\topencode\t%s\tzsh -i -c opencode\n' $(next_id) $tab $cwd >> $st/panes
    (( focus )) && print $tab > $st/focus
    print $tab
    ;;
  list-panes)
    # A pane whose folder is gone reports it as Linux's /proc does.
    while IFS= read -r line; do
      f=("${(@ps:\t:)line}")
      [[ -n $f[4] && ! -d $f[4] ]] && f[4]="$f[4] (deleted)"
      print -r -- "${(pj:\t:)f}"
    done < $st/panes | jq -Rn --rawfile tabs $st/tabs '
      ($tabs | split("\n") | map(select(length > 0) | split("\t") | {key: .[0], value: .[1]})
        | from_entries) as $names
      | [inputs | split("\t") | {id: (.[0] | tonumber), tab_id: (.[1] | tonumber),
          tab_name: $names[.[1]], title: .[2], terminal_command: .[4],
          pane_cwd: (if .[3] == "" then null else .[3] end), exited: (.[5] == "exited"),
          is_plugin: false}]'
    ;;
  go-to-tab-by-id) print $1 > $st/focus ;;
  close-tab-by-id)
    grep -q "^$1	" $st/tabs || exit 1
    awk -F'\t' -v t=$1 '$1 != t' $st/tabs > $st/new && mv $st/new $st/tabs
    awk -F'\t' -v t=$1 '$2 != t' $st/panes > $st/new && mv $st/new $st/panes
    ;;
  new-pane)
    pane= name= cwd=
    while (( $# )); do
      case $1 in
        --pane-id) pane=${2#terminal_}; shift ;;
        -n | --name) name=$2; shift ;;
        --cwd) cwd=$2; shift ;;
        --) shift; break ;;
      esac
      shift
    done
    awk -F'\t' -v OFS='\t' -v p=$pane -v n=$name -v c=$cwd -v cmd="$*" \
      '$1 == p { $3 = n; $4 = c; $5 = cmd } 1' $st/panes > $st/new && mv $st/new $st/panes
    ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$TMP/bin/zellij"
export PATH="$TMP/bin:$PATH"
# This checkout's ADE config (OpenCode through opencode-pane, worktrees in the
# bare layout) with the default tab names, never your own.
jq 'del(.zellij.tabName)' "$ROOT/config/.config/ade/config.json" > "$TMP/ade.json"
export ADE_CONFIG=$TMP/ade.json

tab_in() { # tab whose main pane is in directory $1
  awk -F'\t' -v d="$1" '$3 == "main" && $4 == d { print $2 }' "$ZJ_STATE/panes"
}
focused_tab() { print -r -- "$(<"$ZJ_STATE/focus")"; }
opencode_command() { # $1=tab
  awk -F'\t' -v t="$1" '$2 == t && $3 == "opencode" { print $5 }' "$ZJ_STATE/panes"
}

remote="$TMP/acme/demo.git"
seed="$TMP/seed"
project="$TMP/project"

git init -q --bare "$remote"
git init -q "$seed"
git -C "$seed" config user.name Test
git -C "$seed" config user.email test@example.com
print 'base' > "$seed/app.txt"
print $'.env\nscratch.txt' > "$seed/.gitignore"
git -C "$seed" add app.txt .gitignore
git -C "$seed" commit -qm base
git -C "$seed" branch -M main
git -C "$seed" remote add origin "$remote"
git -C "$seed" push -q -u origin main
git --git-dir="$remote" symbolic-ref HEAD refs/heads/main

source "$ROOT/shell/worktree.zsh"
source "$ROOT/shell/git.zsh"

cd "$TMP"
wtclone "$remote" project >/dev/null
# The repository remembers its layout, so a change of config doesn't move its
# worktrees.
assert_eq "$(git -C "$project" config --get ade.layout)" bare
cd "$project"
wt main >/dev/null
print 'seeded secret' > .env
cd "$project"

# Called directly, the engine prints only the worktree path on stdout (progress,
# such as seeding .env, goes to stderr).
cd "$project/main"
out=$("$ROOT/config/.local/bin/ade" worktree open direct 2>/dev/null)
assert_eq "$out" "$project/direct"
assert_eq "$PWD" "$project/main"
wtrm direct >/dev/null 2>&1

# wt -s creates the worktree but stays put, printing its path.
out=$(wt -s stayed 2>/dev/null)
assert_eq "$out" "$project/stayed"
assert_eq "$PWD" "$project/main"
wtrm stayed >/dev/null 2>&1

# Options go before the branch; leftovers are rejected rather than ignored.
if wt main -t >/dev/null 2>&1; then fail "wt should reject options after the branch"; fi

# A WT_SEED array replaces the defaults even though arrays cannot be exported.
print 'custom' > "$project/main/custom.txt"
WT_SEED=(custom.txt)
wt seed-array >/dev/null
unset WT_SEED
assert_eq "$(<custom.txt)" custom
[[ ! -e .env ]] || fail "WT_SEED should replace the default seed list"

# An unexported WT_SEED_FILE still selects the seed manifest.
cd "$project/main"
print 'custom.txt' > "$TMP/seed-manifest"
WT_SEED_FILE=$TMP/seed-manifest
wt seed-file >/dev/null
unset WT_SEED_FILE
assert_eq "$(<custom.txt)" custom
[[ ! -e .env ]] || fail "WT_SEED_FILE should replace the default seed list"

cd "$project/main"
wtrm -f seed-array >/dev/null
wtrm -f seed-file >/dev/null
rm "$project/main/custom.txt"
cd "$project"

# --- wtprune on branches ---
# A pushed branch whose remote branch was deleted is "gone" and removed; a
# branch that never had an upstream is new work and stays, and so does one
# whose upstream is still there. -m also removes a branch whose exact tip is a
# merged PR's head (gh); a branch whose tip differs (a reused name) stays.
export GH_PR_STATE=OPEN
git -C "$project" config user.name Test
git -C "$project" config user.email test@example.com
pushed() { # $1 = branch: a worktree on a new branch with a commit, pushed with an upstream
  wt -s "$1" >/dev/null 2>&1
  print "$1" > "$project/$1/$1.txt"
  git -C "$project/$1" add "$1.txt"
  git -C "$project/$1" commit -qm "$1"
  git -C "$project/$1" push -q -u origin "$1" 2>/dev/null
}
row() { printf '  %-38s (%s)' "$1" "$2"; } # a line of wtprune's list
cd "$project/main"
pushed gone-branch
pushed kept-branch
wt -s local-only >/dev/null 2>&1
git --git-dir="$remote" update-ref -d refs/heads/gone-branch
# Without a terminal to confirm (as for an agent), wtprune refuses to prompt.
out=$(wtprune </dev/null 2>&1) && fail "wtprune without -y should need a terminal"
assert_eq "$out" $'wtprune: git fetch --all --prune ...\nwtprune: worktrees to remove:\n'"$(row gone-branch 'remote branch deleted')"$'\nwtprune: no terminal to confirm; rerun with -y'
[[ -d $project/gone-branch ]] || fail "an unconfirmed wtprune should remove nothing"
out=$(wtprune -n -y 2>&1)
assert_eq "$out" $'wtprune: worktrees to remove:\n'"$(row gone-branch 'remote branch deleted')"$'\nremoved gone-branch'
[[ ! -d $project/gone-branch ]] || fail "wtprune should remove a worktree whose remote branch was deleted"
[[ -d $project/kept-branch && -d $project/local-only && -d $project/main ]] \
  || fail "wtprune should keep branches with an upstream, without one, and the default branch"
# Not the worktree you are in.
pushed here-gone
git --git-dir="$remote" update-ref -d refs/heads/here-gone
cd "$project/here-gone"
out=$(wtprune -y 2>&1)
assert_eq "$out" $'wtprune: git fetch --all --prune ...\nwtprune: skipping current worktree \'here-gone\' -- cd elsewhere and rerun\nwtprune: nothing to remove.'
cd "$project/main"
wtprune -n -y >/dev/null 2>&1
[[ ! -d $project/here-gone ]] || fail "wtprune should remove the gone worktree once you left it"
# -m: merged through a PR, by the exact tip.
pushed merged-branch
pushed reused-name
export GH_PR_NUMBER=11 GH_PR_STATE=MERGED GH_MERGED_OID=$(git -C "$project" rev-parse merged-branch)
out=$(wtprune -n -m -y 2>&1)
assert_eq "$out" $'wtprune: worktrees to remove:\n'"$(row merged-branch 'merged PR #11')"$'\nremoved merged-branch'
[[ -d $project/reused-name && -d $project/kept-branch ]] || fail "wtprune -m should keep branches whose tip is no merged PR's head"
unset GH_MERGED_OID
export GH_PR_STATE=OPEN
for name in kept-branch local-only reused-name; do wtrm "$name" >/dev/null 2>&1; done

# ggpush and ggpull use the configured upstream (here a contributor's fork),
# even when its tracking ref was pruned, and refuse a detached HEAD.
fork="$TMP/contributor/topic.git"
git init -q --bare "$fork"
git -C "$seed" push -q "$fork" HEAD:refs/heads/fork-topic
git -C "$project" remote add fork "$fork"
git -C "$project" fetch -q fork
git -C "$project" worktree add -q --track -b fork-topic "$project/forked" fork/fork-topic
git --git-dir="$fork" update-ref -d refs/heads/fork-topic
git -C "$project" update-ref -d refs/remotes/fork/fork-topic
cd "$project/forked"
ggpush >/dev/null 2>&1 || fail "ggpush to the fork failed"
git --git-dir="$fork" show-ref -q --verify refs/heads/fork-topic || fail "ggpush should push to the configured fork"
git --git-dir="$remote" show-ref -q --verify refs/heads/fork-topic && fail "ggpush should not fall back to origin"
git switch -q --detach
if ggpush >/dev/null 2>&1; then fail "ggpush should refuse a detached HEAD"; fi
if ggpull >/dev/null 2>&1; then fail "ggpull should refuse a detached HEAD"; fi
cd "$project/main"
wtrm forked >/dev/null 2>&1

# --- wt: the worktree's folder and branch ---
# A new branch starts at origin/HEAD without an upstream (the first push sets
# one), or at the base given; a branch only on the remote, even one pushed
# after the last fetch, tracks it; a local branch is used as it is. The folder
# is <project>/<branch> with / as -. A branch that has a worktree anywhere is
# reused, and so (as it is) is an existing folder of that name.
cd "$project/main"
core open -s fresh
assert_eq "$out" "$project/fresh"
assert_eq "$(git -C "$project/fresh" symbolic-ref --short HEAD)" fresh
assert_eq "$(git -C "$project/fresh" rev-parse HEAD)" "$(git -C "$project" rev-parse origin/HEAD)"
[[ -z $(git -C "$project" config --get branch.fresh.remote) ]] || fail "a new branch should have no upstream"
git -C "$project/fresh" commit -q --allow-empty -m "on fresh"
core open -s based fresh
assert_eq "$(git -C "$project/based" rev-parse HEAD)" "$(git -C "$project" rev-parse fresh)"
git -C "$seed" push -q origin main:refs/heads/remote-only
core open -s remote-only
assert_eq "$(git -C "$project" config --get branch.remote-only.remote) $(git -C "$project" config --get branch.remote-only.merge)" \
  "origin refs/heads/remote-only"
git -C "$project" branch local-branch fresh
core open -s local-branch
assert_eq "$(git -C "$project/local-branch" rev-parse HEAD)" "$(git -C "$project" rev-parse fresh)"
core open -s feature/slashed
assert_eq "$out" "$project/feature-slashed"
assert_eq "$(git -C "$out" symbolic-ref --short HEAD)" feature/slashed
git -C "$project" worktree add -q -b moved "$project/elsewhere" 2>/dev/null
core open -s moved
assert_eq "$out" "$project/elsewhere"
mkdir "$project/plain-folder"
core open -s plain-folder
assert_eq "$out" "$project/plain-folder"
git -C "$project" show-ref -q --verify refs/heads/plain-folder && fail "an existing folder should be used as it is"
rmdir "$project/plain-folder"
# Errors, and nothing on stdout.
core open && fail "wt without a branch should fail"
assert_eq "$out" ""
said "usage: wt [-s|-t|-b] [-p PROMPT] [--session ID] <branch> [base]   (options before the branch)"
core open a b c && fail "wt with three arguments should fail"
mkdir "$TMP/no-repo"
(cd "$TMP/no-repo" && core open x) && fail "wt outside a repository should fail"
said "wt: not inside a git repo"

# --- wt: seeding ---
# Copied from the worktree you are in, or from the default branch's worktree
# when you are in the project folder; a file already in the new worktree (here
# a tracked one) stays as it is; globs match, folders are copied whole. A
# repository's <common-dir>/wt-seed manifest (comments and blank lines allowed)
# wins over WT_SEED; an unsafe pattern there, or an unreadable WT_SEED_FILE,
# stops wt before it creates anything.
core open -s seeded
said "wt: seeded 1 local file(s) from main/ (default seed list)"
assert_eq "$(<"$project/seeded/.env")" 'seeded secret'
cd "$project"
core open -s from-root
said "wt: seeded 1 local file(s) from main/ (default seed list)"
cd "$project/main"
WT_SEED=app.txt core open -s tracked-seed
grep -q '^wt: seeded' "$TMP/err" && fail "a file already in the worktree should not be seeded: $(<"$TMP/err")"
print local > .env.local
mkdir -p config.d/sub && print deep > config.d/sub/file
WT_SEED=$'.env.*\nconfig.d' core open -s globbed
said "wt: seeded 2 local file(s) from main/ (WT_SEED)"
assert_eq "$(<"$project/globbed/.env.local")$(<"$project/globbed/config.d/sub/file")" localdeep
rm -rf .env.local config.d
print $'# local files\n\n  .env  ' > "$project/.bare/wt-seed"
WT_SEED=app.txt core open -s manifest
said "wt: seeded 1 local file(s) from main/ ($project/.bare/wt-seed)"
print '../outside' > "$project/.bare/wt-seed"
core open -s unsafe && fail "an unsafe seed pattern should stop wt"
said "wt: unsafe seed pattern in $project/.bare/wt-seed: ../outside"
rm "$project/.bare/wt-seed"
WT_SEED_FILE=$TMP/missing core open -s unread && fail "an unreadable WT_SEED_FILE should stop wt"
said "wt: WT_SEED_FILE is not readable: $TMP/missing"
[[ ! -e $project/unsafe && ! -e $project/unread ]] || fail "wt should create nothing when seeding can't work"
git -C "$project" show-ref -q --verify refs/heads/unsafe && fail "wt should create no branch when seeding can't work"

# --- wtrm: which worktree ---
# By branch or by folder name, or by absolute path; a name that is a branch of
# one worktree and the folder of another is refused.
core rm feature/slashed
said "removed feature-slashed"
git -C "$project" worktree add -q -b clash "$project/clash-branch" 2>/dev/null
git -C "$project" worktree add -q -b other "$project/clash" 2>/dev/null
core rm clash && fail "an ambiguous name should be refused"
said "wtrm: 'clash' matches both a branch and a worktree directory; use the absolute path"
core rm "$project/clash"
said "removed clash"
core rm nothing-here && fail "an unknown name should fail"
said "wtrm: no worktree found for 'nothing-here'"
core rm && fail "wtrm without a name should fail"
said "usage: wtrm [-f|--force] <branch|worktree>"

# --- wtls ---
# Plain: git's list. --json: no bare entry, no folder deleted by hand, null for
# a detached HEAD, and null counts without origin/HEAD.
assert_eq "$(wtls)" "$(git worktree list)"
rm -rf "$project/clash-branch"
git -C "$project/based" switch -q --detach
core ls --json
[[ $(jq -r '.[].path' <<< "$out") != *".bare"* && $(jq -r '.[].path' <<< "$out") != *clash-branch* ]] \
  || fail "ls --json should list neither the bare repository nor deleted folders: $out"
assert_eq "$(jq -c --arg p "$project/based" '.[] | select(.path == $p) | .branch' <<< "$out")" null
git init -q -b main "$TMP/local-only"
git -C "$TMP/local-only" commit -q --allow-empty -m one
cd "$TMP/local-only"
core ls --json
cd "$project/main"
assert_eq "$out" "[{\"path\":\"$TMP/local-only\",\"branch\":\"main\",\"changed\":0,\"ahead\":null,\"behind\":null,\"tab\":null}]"
(cd "$TMP/no-repo" && core ls --json) && fail "wtls outside a repository should fail"
said "wtls: not inside a git repo"
git -C "$project" worktree prune
for name in fresh based remote-only local-branch elsewhere seeded from-root tracked-seed globbed manifest; do
  core rm -f "$name" || fail "could not remove $name: $(<"$TMP/err")"
done

# --- wtclone ---
# A bare repository in <dir>/.bare, a .git file pointing at it, origin's
# branches as remote-tracking ones, origin/HEAD, and the bare HEAD on the
# default branch; no worktree yet. The folder defaults to the URL's last part.
cd "$TMP"
core clone "$remote"
assert_eq "$out" ""
said "worktree repo ready → cd demo && wt <branch>"
assert_eq "$(<"$TMP/demo/.git")" "gitdir: ./.bare"
assert_eq "$(git --git-dir="$TMP/demo/.bare" config core.bare)" true
assert_eq "$(git --git-dir="$TMP/demo/.bare" config remote.origin.fetch)" '+refs/heads/*:refs/remotes/origin/*'
assert_eq "$(git --git-dir="$TMP/demo/.bare" symbolic-ref refs/remotes/origin/HEAD)" refs/remotes/origin/main
assert_eq "$(git --git-dir="$TMP/demo/.bare" symbolic-ref HEAD)" refs/heads/main
assert_eq "$(git -C "$TMP/demo" worktree list --porcelain | grep -c '^worktree ')" 1
core clone && fail "wtclone without a URL should fail"
said "usage: wtclone <url> [dir]"
core clone "$TMP/acme/missing.git" broken && fail "wtclone of a missing repository should fail"
said "wtclone: fetch failed"

# --- wtconvert ---
# A clean normal clone on a branch, with an origin, becomes the bare layout:
# the branch's worktree in <repo>/<branch>, ignored files moved into it, the
# rest of the top level gone, and your shell in the worktree. It asks first
# (no terminal: it refuses), and refuses a dirty tree, a detached HEAD, no
# origin, a converted repository and a folder outside a clone.
git clone -q "$remote" "$TMP/convertme"
cd "$TMP/convertme"
print secret > .env
print notes > scratch.txt
core convert </dev/null && fail "wtconvert without -y should need a terminal"
said "wtconvert: no terminal to confirm; rerun with -y"
[[ -d .git ]] || fail "an unconfirmed wtconvert should change nothing"
print dirty >> app.txt
core convert -y && fail "wtconvert should refuse a dirty tree"
said "wtconvert: working tree is dirty -- commit or stash changes first:"
git checkout -q app.txt
git switch -q --detach
core convert -y && fail "wtconvert should refuse a detached HEAD"
said "wtconvert: detached HEAD -- check out a branch first"
git switch -q main
wtconvert -y > "$TMP/convert.out" 2>&1 || fail "wtconvert failed: $(<"$TMP/convert.out")"
out=$(grep -v -e "^'origin/HEAD' " -e '^Preparing worktree ' -e '^HEAD is now at ' "$TMP/convert.out")
assert_eq "$out" "convert to worktree layout:
  repo:   $TMP/convertme
  branch: main  ->  $TMP/convertme/main
  keep:   2 ignored path(s) -> moved into the worktree
done -> $TMP/convertme/main   (try: wtls, or wt <other-branch>)"
assert_eq "$PWD" "$TMP/convertme/main"
assert_eq "$(print -l "$TMP/convertme"/*(DN:t))" $'.bare\n.git\nmain'
assert_eq "$(<"$TMP/convertme/.git")" "gitdir: ./.bare"
assert_eq "$(<.env)$(<scratch.txt)" secretnotes
assert_eq "$(git status --porcelain)" ""
core convert -y && fail "wtconvert should refuse a converted repository"
said "wtconvert: $TMP/convertme/main/.git is not a repo dir (already converted?)"
git init -q -b main "$TMP/no-origin"
git -C "$TMP/no-origin" commit -q --allow-empty -m one
(cd "$TMP/no-origin" && core convert -y) && fail "wtconvert should refuse a clone without origin"
said "wtconvert: no 'origin' remote found"
(cd "$TMP/no-repo" && core convert -y) && fail "wtconvert should refuse a folder outside a clone"
said "wtconvert: run this inside a normal (non-bare) git clone"

# --- ade worktree itself ---
core help || fail "ade worktree help failed"
[[ $out == *"open [LAND] <branch> [base]"* ]] || fail "ade worktree help should describe open: $out"
core bogus && fail "an unknown command should fail"
said "ade worktree: unknown command 'bogus' (see: ade worktree help)"
core prune -x && fail "wtprune should reject unknown options"
said "usage: wtprune [-y] [-n|--no-fetch] [-m|--merged]"
cd "$project/main"

# --- Zellij tabs, against the fake zellij: the caller is pane 1 in tab 1. ---
export ZJ_STATE=$TMP/zj ZELLIJ=0 ZELLIJ_SESSION_NAME=test ZELLIJ_PANE_ID=1
mkdir -p "$ZJ_STATE"
# opencode-pane on PATH, as installed.
ln -s "$ROOT/config/.local/bin/opencode-pane" "$TMP/bin/"
print 1000 > "$ZJ_STATE/next" # generated IDs never meet the hand-made ones below
printf '1\thome\n' > "$ZJ_STATE/tabs"
printf '1\t1\tmain\t%s\t-\n' "$TMP" > "$ZJ_STATE/panes"
print 1 > "$ZJ_STATE/focus"
cd "$project/main"

tab_count() { print ${#${(f)"$(<"$ZJ_STATE/tabs")"}}; }
renumber_tab() { # $1=old ID $2=new ID $3=new name, as a restored then renamed tab
  awk -F'\t' -v OFS='\t' -v o="$1" -v n="$2" -v name="$3" '$1 == o { $1 = n; $2 = name } 1' \
    "$ZJ_STATE/tabs" > "$ZJ_STATE/new" && mv "$ZJ_STATE/new" "$ZJ_STATE/tabs"
  awk -F'\t' -v OFS='\t' -v o="$1" -v n="$2" '$2 == o { $2 = n } 1' "$ZJ_STATE/panes" \
    > "$ZJ_STATE/new" && mv "$ZJ_STATE/new" "$ZJ_STATE/panes"
}

# -t opens a focused tab in the worktree; repeating it returns to the same tab.
out=$(wt -t tabbed 2>/dev/null)
assert_eq "$out" "$project/tabbed"
assert_eq "$PWD" "$project/main"
tab=$(tab_in "$project/tabbed")
[[ -n $tab ]] || fail "wt -t should open a tab in the worktree"
assert_eq "$(focused_tab)" "$tab"
# A pane whose program exited reports no cwd; it must not break the lookup.
printf '60\t%s\tlogs\t\t-\texited\n' "$tab" >> "$ZJ_STATE/panes"
zellij action go-to-tab-by-id 1
wt -t tabbed >/dev/null 2>&1
assert_eq "$(focused_tab)" "$tab"
assert_eq "$(tab_count)" 2

# The tab is found by its directory, so a new ID (restored session) and a new
# name change nothing.
renumber_tab "$tab" 99 renamed
zellij action go-to-tab-by-id 1
wt -t tabbed >/dev/null 2>&1
assert_eq "$(focused_tab)" 99
assert_eq "$(tab_count)" 2

# A tab you closed yourself is replaced rather than "focused".
zellij action close-tab-by-id 99
wt -t tabbed >/dev/null 2>&1
tab=$(tab_in "$project/tabbed")
[[ -n $tab && $tab != 99 ]] || fail "wt -t should open a new tab once its tab was closed"
assert_eq "$(tab_count)" 2

# A tab with a live pane that reports no directory may be the worktree's:
# focusing it is harmless, so -t goes there rather than opening a duplicate.
printf '61\t%s\tstarting\t\t-\n' "$tab" >> "$ZJ_STATE/panes"
zellij action go-to-tab-by-id 1
wt -t tabbed >/dev/null 2>&1
assert_eq "$(focused_tab)" "$tab"
assert_eq "$(tab_count)" 2
awk -F'\t' '$1 != 61' "$ZJ_STATE/panes" > "$ZJ_STATE/new" && mv "$ZJ_STATE/new" "$ZJ_STATE/panes"

# -p opens a background tab whose OpenCode starts on the prompt, once.
zellij action go-to-tab-by-id 1
wt -p 'fix the flaky test' prompted >/dev/null 2>&1
tab=$(tab_in "$project/prompted")
assert_eq "$(focused_tab)" 1
[[ $(opencode_command "$tab") == */opencode-pane' --prompt fix the flaky test' ]] \
  || fail "OpenCode should start with the prompt, got: $(opencode_command "$tab")"
if wt -p 'again' prompted >/dev/null 2>&1; then
  fail "wt -p should refuse a worktree whose tab already exists"
fi

# --session opens a background tab whose OpenCode shows that conversation, with
# or without a prompt; like -p, it needs a tab.
wt --session ses_1 -p 'carry on' sessioned >/dev/null 2>&1
tab=$(tab_in "$project/sessioned")
assert_eq "$(focused_tab)" 1
[[ $(opencode_command "$tab") == */opencode-pane' --session ses_1 --prompt carry on' ]] \
  || fail "OpenCode should start on the conversation and prompt, got: $(opencode_command "$tab")"
wt --session ses_2 sessioned-quiet >/dev/null 2>&1
[[ $(opencode_command "$(tab_in "$project/sessioned-quiet")") == */opencode-pane' --session ses_2' ]] \
  || fail "OpenCode should start on the conversation, got: $(opencode_command "$(tab_in "$project/sessioned-quiet")")"
if wt -s --session ses_3 sessioned-stay >/dev/null 2>&1; then fail "--session should refuse -s"; fi
[[ ! -d $project/sessioned-stay ]] || fail "--session with -s should create nothing"
wtrm sessioned >/dev/null 2>&1
wtrm sessioned-quiet >/dev/null 2>&1

# What wt says, on stderr (stdout carries only the path), and the tab it opens:
# the dev layout in the worktree, named after it.
engine() { # `ade worktree open` with these arguments; stdout in $out, stderr in $TMP/err
  : > "$ZJ_STATE/log"
  out=$("$ROOT/config/.local/bin/ade" worktree open "$@" 2>"$TMP/err")
}
called_with() { # $1=zellij command, then words one call of it must include
  local cmd=$1 line word found
  shift
  while IFS= read -r line; do
    [[ $line == "$cmd "* ]] || continue
    found=1
    for word in "$@"; do [[ " $line " == *" $word "* ]] || found=0; done
    (( found )) && return 0
  done < "$ZJ_STATE/log"
  return 1
}
tab_name() { awk -F'\t' -v t="$1" '$1 == t { print $2 }' "$ZJ_STATE/tabs"; }
opencode_pane() { # $1=tab: the opencode pane's cwd and command
  awk -F'\t' -v t="$1" '$2 == t && $3 == "opencode" { print $4 "|" $5 }' "$ZJ_STATE/panes"
}
zellij action go-to-tab-by-id 1
engine -b said || fail "wt -b failed: $(<"$TMP/err")"
assert_eq "$out" "$project/said"
said "wt: opened tab said in the background"
tab=$(tab_in "$project/said")
assert_eq "$(tab_name "$tab")" said
assert_eq "$(focused_tab)" 1
called_with new-tab "--layout dev" "--name said" "--cwd $project/said" --no-focus \
  || fail "expected a background dev tab in the worktree, got: $(<"$ZJ_STATE/log")"
engine -b said || fail "wt -b failed: $(<"$TMP/err")"
assert_eq "$out" "$project/said"
said "wt: said already has a tab"
! called_with new-tab || fail "wt -b should not open a second tab"
engine -t said || fail "wt -t failed: $(<"$TMP/err")"
assert_eq "$out" "$project/said"
assert_eq "$(<"$TMP/err")" ""
assert_eq "$(focused_tab)" "$tab"
zellij action go-to-tab-by-id 1
if engine -p 'go on' said; then fail "wt -p should refuse a worktree with a tab"; fi
assert_eq "$out" ""
assert_eq "$(<"$TMP/err")" "wt: said already has a tab; send the prompt to its OpenCode instead"

# -p: the layout's OpenCode pane is replaced in place, in the background, by
# opencode-pane on the prompt, in the worktree; the pane closes with it.
engine -p '-x "quoted" prompt' spoken || fail "wt -p failed: $(<"$TMP/err")"
assert_eq "$out" "$project/spoken"
assert_eq "$(grep '^wt: ' "$TMP/err" | grep -v '^wt: seeded ')" $'wt: opened tab spoken in the background\nwt: OpenCode in tab spoken is working on the prompt'
tab=$(tab_in "$project/spoken")
assert_eq "$(focused_tab)" 1
called_with new-pane --in-place --close-replaced-pane --no-focus --close-on-exit \
  || fail "expected the opencode pane to be replaced in place, got: $(<"$ZJ_STATE/log")"
pane=$(opencode_pane "$tab")
assert_eq "${pane%%|*}" "$project/spoken"
assert_eq "${${pane#*|}#* }" '--prompt -x "quoted" prompt'
assert_eq "${${${pane#*|}%% *}:A}" "$ROOT/config/.local/bin/opencode-pane"

# Without the caller's pane ID (a script naming only the session), the same.
env -u ZELLIJ_PANE_ID "$ROOT/config/.local/bin/ade" worktree open -b nopane >/dev/null 2>&1 \
  || fail "wt -b without ZELLIJ_PANE_ID failed"
[[ -n $(tab_in "$project/nopane") ]] || fail "wt -b without ZELLIJ_PANE_ID should open a tab"

# When Zellij fails: no tab; no opencode pane in the new tab; OpenCode not
# started. Each fails, saying so; the worktree is there all the same.
if ZJ_FAIL=new-tab engine -b broken; then fail "wt -b should fail when Zellij can't open a tab"; fi
assert_eq "$out" ""
said "wt: could not open a Zellij tab for broken"
[[ -d $project/broken && -z $(tab_in "$project/broken") ]] || fail "a failed new-tab should leave the worktree, without a tab"
if ZJ_NO_AGENT=1 engine -p x agentless; then fail "wt -p should fail without an opencode pane"; fi
assert_eq "$out" ""
assert_eq "$(grep '^wt: ' "$TMP/err" | grep -v '^wt: seeded ')" $'wt: opened tab agentless in the background\nwt: no opencode pane in tab agentless; prompt not sent (the tab stays open)'
[[ -n $(tab_in "$project/agentless") ]] || fail "the tab without an opencode pane should stay open"
if ZJ_FAIL=new-pane engine -p x unstarted; then fail "wt -p should fail when OpenCode can't start"; fi
assert_eq "$out" ""
assert_eq "$(grep '^wt: ' "$TMP/err" | grep -v '^wt: seeded ')" $'wt: opened tab unstarted in the background\nwt: could not start OpenCode with the prompt in tab unstarted'
for name in said spoken nopane broken agentless unstarted; do wtrm -f "$name" >/dev/null 2>&1; done
[[ -z $(tab_in "$project/said")$(tab_in "$project/spoken") ]] || fail "wtrm should close the tabs opened above"

# With zellij.tabName "{project}: {worktree}" (ade-zjstatus can group such
# tabs), a new tab's name has the project's too; it is still found by its
# panes, and the messages name the worktree.
jq '.zellij.tabName = "{project}: {worktree}"' "$TMP/ade.json" > "$TMP/grouped.json"
ADE_CONFIG=$TMP/grouped.json engine -b grouped || fail "wt -b failed: $(<"$TMP/err")"
said "wt: opened tab grouped in the background"
tab=$(tab_in "$project/grouped")
assert_eq "$(tab_name "$tab")" "project: grouped"
ADE_CONFIG=$TMP/grouped.json engine -t grouped || fail "wt -t failed: $(<"$TMP/err")"
assert_eq "$(focused_tab)" "$tab"
zellij action go-to-tab-by-id 1
wtrm grouped >/dev/null 2>&1
[[ -z $(tab_in "$project/grouped") ]] || fail "wtrm should close the grouped tab"

# Whether there is a multiplexer to open tabs in is the ADE config's (finding
# 12): with none configured, even inside Zellij, -t changes directory, -b
# stays and -p fails before creating anything. (Before ade-kit, wt went by
# Zellij's variables, then failed in ade.)
jq '.multiplexer = "none"' "$TMP/ade.json" > "$TMP/none.json"
ADE_CONFIG=$TMP/none.json core open -t unmuxed || fail "wt -t without a multiplexer failed: $(<"$TMP/err")"
assert_eq "$out" "$project/unmuxed"
said "wt: no multiplexer is configured; changing directory instead of opening a tab"
ADE_CONFIG=$TMP/none.json core open -b unmuxed || fail "wt -b without a multiplexer failed: $(<"$TMP/err")"
assert_eq "$out" "$project/unmuxed"
said "wt: no multiplexer is configured; staying here instead of opening a tab"
ADE_CONFIG=$TMP/none.json core open -p x unprompted && fail "wt -p without a multiplexer should fail"
said "wt: -p/--session start OpenCode in a new tab; no multiplexer is configured"
[[ ! -d $project/unprompted ]] || fail "wt -p without a multiplexer should create nothing"
[[ -z $(tab_in "$project/unmuxed") ]] || fail "no tab should open without a multiplexer"
wtrm unmuxed >/dev/null 2>&1

# wtrm closes the worktree's tab.
wtrm -f prompted >/dev/null 2>&1
[[ -z $(tab_in "$project/prompted") ]] || fail "wtrm should close the worktree's tab"
wtrm tabbed >/dev/null 2>&1

# A tab with only some panes in the worktree (here the home tab, where one
# shell cd'd into it) is neither the worktree's tab nor closed with it.
wt -s mixed >/dev/null 2>&1
printf '70\t1\tshell\t%s\t-\n' "$project/mixed/src" >> "$ZJ_STATE/panes"
wt -t mixed >/dev/null 2>&1
tab=$(tab_in "$project/mixed")
[[ -n $tab && $tab != 1 ]] || fail "wt -t should not treat a mixed tab as the worktree's tab"
wtrm mixed >/dev/null 2>&1
grep -q "^1	" "$ZJ_STATE/tabs" || fail "wtrm should not close a tab with panes elsewhere"
[[ -z $(tab_in "$project/mixed") ]] || fail "wtrm should close the worktree's own tab"

# A live pane that reports no directory (OpenCode starting, Zellij busy) could
# be anywhere, so its tab is not closed even if its other panes are inside.
wt -b unsure >/dev/null 2>&1
printf '80\tuser\n' >> "$ZJ_STATE/tabs"
printf '81\t80\tmain\t%s\t-\n82\t80\topencode\t\t-\n' "$project/unsure/src" >> "$ZJ_STATE/panes"
wtrm unsure >/dev/null 2>&1
grep -q "^80	" "$ZJ_STATE/tabs" || fail "wtrm should not close a tab with a pane of unknown directory"
[[ -z $(tab_in "$project/unsure") ]] || fail "wtrm should still close the worktree's own tab"

# wtrm leaves the tab you run it from open.
wt -b mine >/dev/null 2>&1
tab=$(tab_in "$project/mine")
(
  export ZELLIJ_PANE_ID=$(awk -F'\t' -v t="$tab" '$2 == t && $3 == "main" { print $1 }' "$ZJ_STATE/panes")
  cd "$project/mine" && wtrm mine >/dev/null 2>&1
)
grep -q "^$tab	" "$ZJ_STATE/tabs" || fail "wtrm should leave the caller's own tab open"
[[ ! -d $project/mine ]] || fail "wtrm should remove the worktree it runs from"
zellij action close-tab-by-id "$tab"

# The caller's pane must exist to know which tab to spare; otherwise nothing is
# closed. Commands run by an OpenCode agent (OPENCODE_TERMINAL=1) close no tabs.
for caller in 999 agent; do
  wt -b stale >/dev/null 2>&1
  tab=$(tab_in "$project/stale")
  if [[ $caller == agent ]]; then
    out=$(OPENCODE_TERMINAL=1 wtrm stale 2>&1)
    reason="OpenCode agents don't close tabs"
  else
    out=$(ZELLIJ_PANE_ID=$caller wtrm stale 2>&1)
    reason="could not tell which tab you are in"
  fi
  grep -q "^$tab	" "$ZJ_STATE/tabs" || fail "wtrm ($caller) should close no tab"
  [[ $out == *"$reason"* ]] || fail "wtrm ($caller) should say why the tab stays: $out"
  zellij action close-tab-by-id "$tab"
done

# What wtrm says about each tab, on stderr after "removed" (stdout stays
# empty); it closes nothing when the worktree can't be removed.
rm_engine() { # `ade worktree rm` with these arguments; stdout in $out, stderr in $TMP/err
  : > "$ZJ_STATE/log"
  out=$("$ROOT/config/.local/bin/ade" worktree rm "$@" 2>"$TMP/err")
}
has_tab() { grep -q "^$1	" "$ZJ_STATE/tabs"; }
wt -b two >/dev/null 2>&1
first=$(tab_in "$project/two")
printf '900\ttwo again\n' >> "$ZJ_STATE/tabs"
printf '901\t900\tmain\t%s\t-\n' "$project/two/src" >> "$ZJ_STATE/panes"
print draft > "$project/two/notes.md"
if rm_engine two; then fail "wtrm should refuse a worktree with untracked files"; fi
has_tab "$first" && has_tab 900 || fail "a wtrm that removes nothing should close no tab"
! called_with close-tab-by-id || fail "a wtrm that removes nothing should close no tab: $(<"$ZJ_STATE/log")"
rm_engine -f two || fail "wtrm -f failed: $(<"$TMP/err")"
assert_eq "$out" ""
assert_eq "$(<"$TMP/err")" $'removed two\nclosed the tab of two\nclosed the tab of two'
! has_tab "$first" && ! has_tab 900 || fail "wtrm should close both of the worktree's tabs"

# Your own tab stays, and so does one with a pane of unknown directory.
wt -b kept >/dev/null 2>&1
own=$(tab_in "$project/kept")
own_pane=$(awk -F'\t' -v t="$own" '$2 == t && $3 == "main" { print $1 }' "$ZJ_STATE/panes")
printf '910\tkept unsure\n' >> "$ZJ_STATE/tabs"
printf '911\t910\tmain\t%s\t-\n912\t910\topencode\t\t-\n' "$project/kept" >> "$ZJ_STATE/panes"
(cd "$project/kept" && ZELLIJ_PANE_ID=$own_pane rm_engine kept) || fail "wtrm kept failed: $(<"$TMP/err")"
assert_eq "$(<"$TMP/err")" \
  $'removed kept\nleft a tab of kept open (Zellij did not report where all its panes are)\nleft the tab of kept open (you are in it)'
has_tab "$own" && has_tab 910 || fail "wtrm should leave your tab and the unsure one open"
zellij action close-tab-by-id "$own"
zellij action close-tab-by-id 910

# A tab Zellij won't close is a warning, not a failure. Without a pane ID,
# which tab is yours is unknown: nothing closes.
wt -b stuck >/dev/null 2>&1
stuck=$(tab_in "$project/stuck")
ZJ_FAIL=close-tab-by-id rm_engine stuck || fail "wtrm should succeed when a tab won't close: $(<"$TMP/err")"
assert_eq "$(head -n 1 "$TMP/err")" "removed stuck"
assert_eq "$(tail -n 1 "$TMP/err")" "warning: could not close the tab of stuck"
has_tab "$stuck" || fail "the tab that would not close should still be there"
zellij action close-tab-by-id "$stuck"
wt -b paneless >/dev/null 2>&1
paneless=$(tab_in "$project/paneless")
(unset ZELLIJ_PANE_ID; rm_engine paneless) || fail "wtrm without a pane ID failed: $(<"$TMP/err")"
assert_eq "$(<"$TMP/err")" $'removed paneless\nleft the tabs of paneless open (could not tell which tab you are in)'
has_tab "$paneless" || fail "wtrm without a pane ID should close no tab"
zellij action close-tab-by-id "$paneless"

# ls --json reports each worktree's branch, changes and tab, for the plugin.
wt -b listed >/dev/null 2>&1
print change > "$project/listed/notes.md"
json=$("$ROOT/config/.local/bin/ade" worktree ls --json)
entry() { jq -c --arg p "$project/$1" '.[] | select(.path == $p) | {branch, changed, ahead, behind, tab}' <<< "$json"; }
assert_eq "$(entry listed)" '{"branch":"listed","changed":1,"ahead":0,"behind":0,"tab":"sure"}'
assert_eq "$(entry main)" '{"branch":"main","changed":0,"ahead":0,"behind":0,"tab":null}'
# Without the caller's pane the tabs are found all the same; outside Zellij
# there are none. A live pane that reports no directory makes a tab "unsure".
json=$(env -u ZELLIJ_PANE_ID "$ROOT/config/.local/bin/ade" worktree ls --json)
assert_eq "$(entry listed | jq -r .tab)" sure
json=$(env -u ZELLIJ "$ROOT/config/.local/bin/ade" worktree ls --json)
assert_eq "$(entry listed | jq -r .tab)" null
listed_tab=$(tab_in "$project/listed")
printf '62\t%s\tstarting\t\t-\n' "$listed_tab" >> "$ZJ_STATE/panes"
json=$("$ROOT/config/.local/bin/ade" worktree ls --json)
assert_eq "$(entry listed | jq -r .tab)" unsure
assert_eq "$(entry main | jq -r .tab)" null
wtrm -f listed >/dev/null 2>&1
zellij action close-tab-by-id "$listed_tab"

# A worktree nested inside another (in a plain clone, wt puts them inside the
# repository) has its own tabs, which don't count for the outer one.
git clone -q "$remote" "$TMP/plain"
cd "$TMP/plain"
wt -b inner >/dev/null 2>&1
inner_tab=$(tab_in "$TMP/plain/inner")
[[ -n $inner_tab ]] || fail "wt -b should open a tab for the nested worktree"
json=$("$ROOT/config/.local/bin/ade" worktree ls --json)
assert_eq "$(jq -c '[.[] | {path, tab}]' <<< "$json")" \
  "$(jq -cn --arg p "$TMP/plain" '[{path: $p, tab: null}, {path: ($p + "/inner"), tab: "sure"}]')"
zellij action go-to-tab-by-id 1
wt -t main >/dev/null 2>&1
outer_tab=$(tab_in "$TMP/plain")
[[ -n $outer_tab && $outer_tab != "$inner_tab" ]] || fail "wt -t should open the outer worktree's own tab"
assert_eq "$(focused_tab)" "$outer_tab"
cd "$project/main"

# Outside Zellij, -p fails before creating anything and -t changes directory.
unset ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID
core open -p x outside && fail "wt -p outside Zellij should fail"
said "wt: -p/--session start OpenCode in a Zellij tab; not inside Zellij"
core open -b outside-b || fail "wt -b outside Zellij failed: $(<"$TMP/err")"
said "wt: not inside Zellij; staying here instead of opening a tab"
assert_eq "$out" "$project/outside-b"
core open -t outside-b
said "wt: not inside Zellij; changing directory instead of opening a tab"
if wt -p 'x' outside >/dev/null 2>&1; then fail "wt -p outside Zellij should fail"; fi
[[ ! -d $project/outside ]] || fail "wt -p outside Zellij should not create a worktree"
wt -t outside >/dev/null 2>&1
assert_eq "$PWD" "$project/outside"

print "worktree tests: ok"
