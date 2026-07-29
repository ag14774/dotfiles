# worktree.plugin.zsh
# Bare-repo + git worktree helpers for parallel development.
#
# Layout produced by `wtclone`:
#   <proj>/.bare       the bare repo (shared history/objects; no working tree)
#   <proj>/.git        a FILE: "gitdir: ./.bare"  (makes <proj> act as the repo root)
#   <proj>/<branch>/   one working tree per branch (created by `wt`)
#
# Commands:
#   wtclone <url> [dir]   set up a bare repo + worktree layout from a remote
#   wt <branch> [base]    create/reuse a worktree for <branch> and cd into it
#                         (seeds $WT_SEED files -- .env etc. -- into new worktrees)
#   wtrm <branch>         remove a worktree
#   wtprune [-ynm]        wtrm worktrees whose remote branch was deleted ("gone");
#                         -m/--merged also removes merged branches (GitHub via gh)
#   wtls                  list worktrees
#   wtconvert [-y]        convert a normal clone (CWD) into this bare/worktree layout
#   wthelp                show help for these commands

# --- internal helpers (shared by wtclone + wtconvert so the two can't drift) ---
# configure a .bare repo for the worktree workflow (run BEFORE fetching)
_wt_setup_bare() {   # $1 = project dir that contains .bare
  local d=$1
  git --git-dir="$d/.bare" config core.bare true
  git --git-dir="$d/.bare" config core.logallrefupdates true
  git --git-dir="$d/.bare" config --unset core.worktree 2>/dev/null
  git --git-dir="$d/.bare" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
}
# after fetching: set origin/HEAD, then point the bare HEAD at the default branch
_wt_finish_bare() {  # $1 = project dir that contains .bare
  local d=$1 def
  git -C "$d" remote set-head origin --auto 2>/dev/null
  def=$(git --git-dir="$d/.bare" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null)
  def=${def#refs/remotes/origin/}
  [[ -n $def ]] && git --git-dir="$d/.bare" symbolic-ref HEAD "refs/heads/$def"
}

# set up a bare repo + worktree layout from a remote (no local branches until `wt`)
wtclone() {
  emulate -L zsh
  local url="$1" dir="${2:-$(basename "${1%.git}")}"
  [[ -z "$url" ]] && { print -u2 "usage: wtclone <url> [dir]"; return 1; }
  git init -q --bare "$dir/.bare" || return 1
  print 'gitdir: ./.bare' > "$dir/.git"
  git --git-dir="$dir/.bare" remote add origin "$url"
  _wt_setup_bare "$dir"
  git -C "$dir" fetch origin || { print -u2 "wtclone: fetch failed"; return 1; }
  _wt_finish_bare "$dir"
  print "worktree repo ready → cd ${dir} && wt <branch>"
}

# Untracked/ignored files git won't carry into a new worktree but you want there
# anyway (secrets, local config). Globs allowed; override in ~/.zshrc. Do NOT list
# .venv/node_modules -- recreate those (uv sync / npm install), don't copy them.
(( $+WT_SEED )) || typeset -ga WT_SEED=(.env '.env.*' .envrc pyrightconfig.json)

# copy WT_SEED matches from $1 (source worktree) into $2 (new worktree), skipping
# any that already exist so each worktree keeps its own copies.
_wt_seed() {
  emulate -L zsh
  setopt local_options null_glob
  local src=$1 dest=$2 pat f rel n=0
  [[ -n $src && -d $src && $src != $dest ]] || return 0
  for pat in $WT_SEED; do
    for f in $src/${~pat}; do
      [[ -e $f ]] || continue   # literal patterns (.env, .envrc) skip null_glob; drop them when the source lacks them
      rel=${f#$src/}
      [[ -e $dest/$rel ]] && continue
      mkdir -p "$dest/${rel:h}" && cp -R "$f" "$dest/$rel" && (( n++ ))
    done
  done
  (( n )) && print "wt: seeded $n local file(s) from ${src:t}/ (WT_SEED)"
  return 0
}

# print the path of the worktree checked out on the repo's default branch
# (origin/HEAD, e.g. develop or main), or nothing if it can't be found. Used as
# the seed source when `wt` runs from the bare root, where there's no current
# worktree to copy from.
_wt_default_worktree() {
  emulate -L zsh
  local gitdir=$1 def line cur=
  def=$(git --git-dir="$gitdir" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null)
  def=${def#refs/remotes/origin/}
  [[ -z $def ]] && { def=$(git --git-dir="$gitdir" symbolic-ref --quiet HEAD 2>/dev/null); def=${def#refs/heads/}; }
  [[ -z $def ]] && return 0
  for line in ${(f)"$(git --git-dir="$gitdir" worktree list --porcelain 2>/dev/null)"}; do
    case $line in
      ("worktree "*) cur=${line#worktree } ;;
      ("branch refs/heads/$def") print -r -- "$cur"; return 0 ;;
    esac
  done
  return 0
}

# create/reuse a worktree for <branch> and cd into it
wt() {
  emulate -L zsh
  local branch="$1" base="${2:-origin/HEAD}"
  [[ -z "$branch" ]] && { print -u2 "usage: wt <branch> [base]"; return 1; }
  local common proj wtdir
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
    || { print -u2 "wt: not inside a git repo"; return 1; }
  proj=${common:h}
  wtdir="$proj/${branch//\//-}"
  if [[ ! -d "$wtdir" ]]; then
    git -C "$proj" fetch -q origin
    if git -C "$proj" show-ref -q --verify "refs/heads/$branch"; then
      git -C "$proj" worktree add "$wtdir" "$branch" || return 1                               # existing local branch
    elif git -C "$proj" show-ref -q --verify "refs/remotes/origin/$branch"; then
      git -C "$proj" worktree add --track -b "$branch" "$wtdir" "origin/$branch" || return 1   # new branch tracking origin
    else
      git -C "$proj" worktree add --no-track -b "$branch" "$wtdir" "$base" || return 1         # brand-new branch: --no-track so it doesn't inherit the base's upstream; first push sets origin/<branch> (push.autoSetupRemote)
    fi
    # seed untracked local files (.env, etc.) into the new worktree: prefer the
    # worktree we're standing in; if we're not in one (e.g. run from the bare
    # root), fall back to the default branch's worktree (origin/HEAD).
    local src; src=$(git rev-parse --show-toplevel 2>/dev/null)
    [[ -z $src ]] && src=$(_wt_default_worktree "$common")
    [[ $src == $wtdir ]] && src=   # never seed a worktree from itself
    _wt_seed "$src" "$wtdir"
  fi
  cd "$wtdir"
}

# remove a worktree
wtrm() {
  emulate -L zsh
  local branch="$1"
  [[ -z "$branch" ]] && { print -u2 "usage: wtrm <branch>"; return 1; }
  local common proj
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
    || { print -u2 "wtrm: not inside a git repo"; return 1; }
  proj=${common:h}
  git -C "$proj" worktree remove "$proj/${branch//\//-}" && print "removed ${branch//\//-}"
}

# list worktrees
wtls() { git worktree list; }

# Is <branch> merged? Used by `wtprune --merged`. Sets $REPLY to a short reason.
#   (1) OFFLINE, any remote: the branch tip is an ancestor of origin/<default>
#       -- catches merge-commit / rebase / fast-forward merges.
#   (2) GITHUB ONLY: for squash-merged and/or deleted branches (which leave no
#       local trace), ask gh for a MERGED PR whose merged commit (headRefOid)
#       EQUALS the branch tip. Matching the SHA -- not just the name -- avoids a
#       false hit when a branch NAME was reused for new, unrelated work.
_wtprune_merged() { # $1=proj  $2=default-branch  $3=gh_ok  $4=branch
  emulate -L zsh
  local proj=$1 def=$2 gh_ok=$3 b=$4 tip pr
  if [[ -n $def ]] && git -C "$proj" merge-base --is-ancestor \
    "refs/heads/$b" "refs/remotes/origin/$def" 2>/dev/null; then
    REPLY="merged into $def"
    return 0
  fi
  (( gh_ok )) || return 1
  tip=$(git -C "$proj" rev-parse "refs/heads/$b" 2>/dev/null) || return 1
  pr=$(cd "$proj" && gh pr list --head "$b" --state merged --json number,headRefOid \
    --jq ".[] | select(.headRefOid==\"$tip\") | .number" 2>/dev/null | head -1)
  [[ -n $pr ]] && { REPLY="merged PR #$pr"; return 0; }
  return 1
}

# Remove worktrees you're done with. By DEFAULT that means the branch's upstream
# was DELETED on the remote ("gone"): you were tracking origin/<b> and it's now
# gone. Branches that never recorded an upstream are LEFT ALONE (they may be new
# local work you haven't pushed). Runs `git fetch --prune` first (skip -n) so the
# gone status is fresh, lists the matches, then confirms before removing.
#
# With -m/--merged it ALSO removes worktrees whose branch has been MERGED:
#   - offline, any remote: the branch is an ancestor of origin/HEAD; plus
#   - GITHUB ONLY (needs `gh`): squash-merged and/or deleted branches, matched by
#     commit SHA against a merged PR. On non-GitHub remotes or without `gh`, only
#     the offline ancestry check runs (it says so).
#   wtprune              remove worktrees whose tracked remote branch was deleted
#   wtprune -m|--merged  ALSO remove worktrees whose branch has been merged
#   wtprune -y           don't prompt
#   wtprune -n           skip the fetch --prune
wtprune() {
  emulate -L zsh
  local yes=0 fetch=1 merged=0 arg
  for arg in "$@"; do
    case $arg in
      -y|--yes) yes=1 ;;
      -n|--no-fetch) fetch=0 ;;
      -m|--merged) merged=1 ;;
      *) print -u2 "usage: wtprune [-y] [-n|--no-fetch] [-m|--merged]"; return 1 ;;
    esac
  done

  local common proj
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
    || { print -u2 "wtprune: not inside a git repo"; return 1; }
  proj=${common:h}

  if (( fetch )); then
    print "wtprune: git fetch --prune ..."
    git -C "$proj" fetch --prune --quiet \
      || print -u2 "wtprune: fetch failed; continuing with cached remote-tracking refs"
  fi

  # Default branch (origin/HEAD short name): the --merged ancestry target, and
  # never a removal candidate itself.
  local def
  def=$(git -C "$proj" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null)
  def=${def#refs/remotes/origin/}

  # Branches whose upstream is configured but now gone (remote branch deleted).
  # Skips branches with no upstream ($up empty) -- those never had a remote.
  local -A gone
  local line br rest up track
  for line in ${(f)"$(git -C "$proj" for-each-ref \
    --format='%(refname:short)%09%(upstream)%09%(upstream:track)' refs/heads 2>/dev/null)"}; do
    br=${line%%$'\t'*}; rest=${line#*$'\t'}
    up=${rest%%$'\t'*}; track=${rest#*$'\t'}
    [[ -n $up && $track == *gone* ]] && gone[$br]=1
  done

  # --merged needs gh for the squash-merged/deleted case (GitHub only).
  local gh_ok=0
  if (( merged )); then
    if (( $+commands[gh] )); then
      gh_ok=1
    else
      print -u2 "wtprune: --merged: gh not found -- using the offline ancestry check only"
    fi
  fi

  # Walk the worktrees. A worktree is a target if its branch is gone, or (with
  # --merged) merged. Skip the default branch and the one we're standing in.
  local curwt; curwt=$(git rev-parse --show-toplevel 2>/dev/null)
  local -a targets
  local -A why
  local wtpath= b=
  for line in ${(f)"$(git -C "$proj" worktree list --porcelain 2>/dev/null)"}; do
    case $line in
      ("worktree "*) wtpath=${line#worktree }; b= ;;
      ("branch refs/heads/"*)
        b=${line#branch refs/heads/}
        [[ $b == $def ]] && continue
        if [[ -n $curwt && $wtpath == $curwt ]]; then
          [[ -n ${gone[$b]} ]] && print -u2 "wtprune: skipping current worktree '$b' -- cd elsewhere and rerun"
          continue
        fi
        if [[ -n ${gone[$b]} ]]; then
          targets+=$b
          why[$b]="remote branch deleted"
        elif (( merged )) && _wtprune_merged "$proj" "$def" "$gh_ok" "$b"; then
          targets+=$b
          why[$b]=$REPLY
        fi
        ;;
    esac
  done

  if (( ! $#targets )); then
    print "wtprune: nothing to remove."
    return 0
  fi

  print "wtprune: worktrees to remove:"
  local t
  for t in $targets; do printf '  %-38s (%s)\n' "$t" "${why[$t]}"; done
  if (( ! yes )); then
    print -n "remove them? [y/N] "
    local reply; read -r reply
    [[ $reply == [yY]* ]] || { print "aborted"; return 1; }
  fi

  for t in $targets; do wtrm "$t"; done
}

# convert a NORMAL clone (in the CWD) into the bare + worktree layout `wtclone` makes.
# Safe by default: refuses a dirty tree, relocates ignored files into the new worktree,
# and only deletes top-level TRACKED files (which are committed -> recoverable).
#   wtconvert         convert, with a confirmation prompt
#   wtconvert -y      convert without prompting
wtconvert() {
  emulate -L zsh

  local yes=0
  [[ $1 == (-y|--yes) ]] && { yes=1; shift }

  # must be inside a normal (non-bare) work tree
  [[ $(git rev-parse --is-inside-work-tree 2>/dev/null) == true ]] \
    || { print -u2 "wtconvert: run this inside a normal (non-bare) git clone"; return 1 }
  local root branch branchdir
  root=$(git rev-parse --show-toplevel) || return 1
  branch=$(git symbolic-ref --quiet --short HEAD) \
    || { print -u2 "wtconvert: detached HEAD -- check out a branch first"; return 1 }
  branchdir=${branch//\//-}
  git -C "$root" remote get-url origin >/dev/null 2>&1 \
    || { print -u2 "wtconvert: no 'origin' remote found"; return 1 }
  [[ -d $root/.git ]] \
    || { print -u2 "wtconvert: $root/.git is not a repo dir (already converted?)"; return 1 }

  # refuse if not clean; ignored files are fine (relocated into the worktree below)
  if [[ -n "$(git -C "$root" status --porcelain --untracked-files=all)" ]]; then
    print -u2 "wtconvert: working tree is dirty -- commit or stash changes first:"
    git -C "$root" status --short >&2
    return 1
  fi

  # ignored paths to preserve (e.g. .env, node_modules/); whole ignored dirs come collapsed
  local ig
  ig=$(git -C "$root" -c core.quotePath=false status --ignored --porcelain 2>/dev/null \
        | awk '/^!! /{print substr($0,4)}')
  local -a ignored; ignored=(${(f)ig})

  print "convert to worktree layout:"
  print "  repo:   $root"
  print "  branch: $branch  ->  $root/$branchdir"
  (( $#ignored )) && print "  keep:   $#ignored ignored path(s) -> moved into the worktree"
  if (( ! yes )); then
    print -n "proceed? [y/N] "; local reply; read -r reply
    [[ $reply == [yY]* ]] || { print "aborted"; return 1 }
  fi

  # 1) .git dir -> bare .bare, plus the "gitdir: ./.bare" pointer file, then set up
  #    the bare repo exactly like wtclone does (shared helpers => identical result)
  mv "$root/.git" "$root/.bare" || return 1
  print 'gitdir: ./.bare' > "$root/.git"
  _wt_setup_bare "$root"
  git -C "$root" fetch origin 2>/dev/null || print -u2 "wtconvert: warning: fetch failed (using existing refs)"
  _wt_finish_bare "$root"

  # 2) recreate the current branch as a real worktree (fresh checkout of tracked files)
  git -C "$root" worktree add "$root/$branchdir" "$branch" || {
    print -u2 "wtconvert: 'worktree add' failed; repo is bare at $root (your files are still there)"; return 1
  }

  # 3) relocate preserved ignored files into the new worktree
  local rel src dst
  for rel in $ignored; do
    rel=${rel%/}
    src="$root/$rel"; dst="$root/$branchdir/$rel"
    [[ -e $src ]] || continue
    [[ -e $dst ]] && { print -u2 "  skip (already in worktree): $rel"; continue }
    mkdir -p "${dst:h}" && mv "$src" "$dst"
  done

  # 4) drop the now-redundant top-level tracked files (all committed -> recoverable)
  local entry
  for entry in "$root"/*(DN); do
    case ${entry:t} in
      .bare|.git|$branchdir) continue ;;
      *) rm -rf -- "$entry" ;;
    esac
  done

  cd "$root/$branchdir"
  print "done -> $PWD   (try: wtls, or wt <other-branch>)"
}

# show help for the worktree commands
wthelp() {
  emulate -L zsh
  print -r -- 'worktree commands (bare repo + git worktrees):
  wtclone <url> [dir]   bare-clone a repo and set it up for worktrees
  wt <branch> [base]    create/reuse a worktree for <branch> and cd into it
                        (base defaults to origin/HEAD; tab-completes branches;
                         seeds $WT_SEED files -- .env etc. -- into new worktrees)
  wtrm <branch>         remove a worktree            (tab-completes worktrees)
  wtprune [-ynm]        remove worktrees whose remote branch was deleted ("gone");
                        leaves branches that never had a remote. -n skips fetch --prune;
                        -m/--merged also removes MERGED branches (ancestry offline;
                        squash-merged/deleted via gh -- GitHub only)
  wtls                  list worktrees
  wtconvert [-y]        convert a normal clone (CWD) into the bare/worktree layout
                        (needs a clean tree; keeps ignored files; stashes survive)
  wthelp                show this help'
}

# ---- completions -------------------------------------------------------------
# shell/init.zsh runs `compinit` before the ~/.zshrc block sources this file, so
# `compdef` already exists here. `compdef _fn cmd` registers: "to complete `cmd`,
# run the shell function `_fn`". Inside _fn we build an array of candidates and
# hand them to `compadd`, which shows/inserts them.

# complete `wt` with local + origin/* branch names
_wt() {
  local -a branches
  branches=(${(f)"$(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes/origin 2>/dev/null)"})
  branches=(${branches:#origin/HEAD})   # drop the origin/HEAD symref first...
  branches=(${branches#origin/})        # ...then strip the "origin/" prefix
  compadd -a -- ${(u)branches}          # (u) = keep unique names only
}
(( $+functions[compdef] )) && compdef _wt wt

# complete `wtrm` with the names of EXISTING worktrees (minus the bare repo)
_wtrm() {
  local -a wts
  wts=(${(f)"$(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}')"})
  wts=(${wts:t})                        # :t = basename of each worktree path
  compadd -a -- ${wts:#.bare}           # drop the ".bare" repo itself
}
(( $+functions[compdef] )) && compdef _wtrm wtrm

# complete `wtprune` with its flags
_wtprune() { compadd -- -y --yes -n --no-fetch -m --merged; }
(( $+functions[compdef] )) && compdef _wtprune wtprune

true  # ensure the plugin always sources with a success status
