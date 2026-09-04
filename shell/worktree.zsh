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
#                         (seeds configured local files into new worktrees)
#   wtreview <pr>         review a GitHub PR with its changes visible in Helix
#   wtchange              turn the current review worktree into the PR branch
#   wtrm [-f] <name>      remove a worktree by branch or directory name
#   wtprune [-ynm]        wtrm worktrees whose remote branch was deleted ("gone");
#                         -m also removes merged branches/clean PR reviews (via gh)
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
# anyway (secrets, local config). Globs allowed; override in ~/.zshrc. A readable
# <git-common-dir>/wt-seed replaces these defaults for one repository, and
# WT_SEED_FILE can select an explicit manifest. Do NOT list .venv/node_modules --
# recreate those (uv sync / npm install), don't copy them.
(( $+WT_SEED )) || typeset -ga WT_SEED=(.env '.env.*' .envrc pyrightconfig.json)

# Copy configured matches from $1 (source worktree) into $2 (new worktree),
# skipping any that already exist so each worktree keeps its own copies. $3 is
# the git common dir. A seed manifest contains one relative path/glob per line;
# blank lines and comments are ignored.
_wt_seed() {
  emulate -L zsh
  setopt local_options extended_glob null_glob
  local src=$1 dest=$2 common=$3 pat f rel line n=0
  local seed_file="${WT_SEED_FILE:-$common/wt-seed}"
  local seed_label=WT_SEED
  local -a patterns
  reply=()

  if [[ -n ${WT_SEED_FILE:-} && ! -r $seed_file ]]; then
    print -u2 "wt: WT_SEED_FILE is not readable: $seed_file"
    return 1
  fi

  if [[ -r $seed_file ]]; then
    while IFS= read -r line || [[ -n $line ]]; do
      pat=${line%$'\r'}
      pat=${pat##[[:space:]]#}
      pat=${pat%%[[:space:]]#}
      [[ -z $pat || $pat == \#* ]] && continue
      if [[ $pat == /* || $pat == .. || $pat == ../* || $pat == */../* || $pat == */.. ]]; then
        print -u2 "wt: unsafe seed pattern in $seed_file: $pat"
        return 1
      fi
      patterns+=("$pat")
    done < "$seed_file"
    seed_label=$seed_file
  else
    patterns=("${WT_SEED[@]}")
  fi

  [[ -n $src && -d $src && $src != $dest ]] || return 0
  for pat in "${patterns[@]}"; do
    for f in $src/${~pat}; do
      [[ -e $f ]] || continue   # literal patterns (.env, .envrc) skip null_glob; drop them when the source lacks them
      rel=${f#$src/}
      [[ -e $dest/$rel ]] && continue
      mkdir -p "$dest/${rel:h}" && cp -R "$f" "$dest/$rel" && { (( n++ )); reply+=("$rel"); }
    done
  done
  (( n )) && print "wt: seeded $n local file(s) from ${src:t}/ ($seed_label)"
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

# Set REPLY to the registered worktree path for a local branch, or empty.
_wt_worktree_for_branch() { # $1=project root $2=branch
  emulate -L zsh
  local proj=$1 branch=$2 line wtpath=
  REPLY=
  for line in ${(f)"$(git -C "$proj" worktree list --porcelain 2>/dev/null)"}; do
    case $line in
      ("worktree "*) wtpath=${line#worktree } ;;
      ("branch refs/heads/$branch") REPLY=$wtpath; return 0 ;;
    esac
  done
  return 1
}

# Set REPLY to a registered worktree selected by branch or directory basename.
_wt_worktree_for_arg() { # $1=project root $2=branch-or-name
  emulate -L zsh
  local proj=$1 arg=$2 line wtpath= branch_path= name_path=
  if [[ $arg == /* ]]; then
    for line in ${(f)"$(git -C "$proj" worktree list --porcelain 2>/dev/null)"}; do
      [[ $line == "worktree "* && ${line#worktree } == $arg ]] \
        && { REPLY=$arg; return 0; }
    done
    REPLY=
    return 1
  fi
  _wt_worktree_for_branch "$proj" "$arg" && branch_path=$REPLY
  for line in ${(f)"$(git -C "$proj" worktree list --porcelain 2>/dev/null)"}; do
    [[ $line == "worktree "* ]] || continue
    wtpath=${line#worktree }
    [[ $wtpath != $proj && ${wtpath:t} == $arg ]] && name_path=$wtpath
  done
  if [[ -n $branch_path && -n $name_path && $branch_path != $name_path ]]; then
    REPLY=
    return 2
  fi
  [[ -n $branch_path ]] && { REPLY=$branch_path; return 0; }
  [[ -n $name_path ]] && { REPLY=$name_path; return 0; }
  REPLY="$proj/${arg//\//-}"
  [[ -d $REPLY ]]
}

# Review metadata lives beside the linked worktree's private HEAD/index, never
# in the checked-out PR. Set REPLY to that metadata file.
_wt_review_meta() { # $1=worktree
  emulate -L zsh
  local gitdir
  gitdir=$(git -C "$1" rev-parse --path-format=absolute --git-dir 2>/dev/null) || { REPLY=; return 1; }
  REPLY="$gitdir/wt-review"
}

_wt_review_get() { # $1=worktree $2=key
  emulate -L zsh
  local meta
  _wt_review_meta "$1" || return 1
  meta=$REPLY
  git config --file "$meta" --get "review.$2" 2>/dev/null
}

_wt_review_set() { # $1=worktree $2=key $3=value
  emulate -L zsh
  local meta
  _wt_review_meta "$1" || return 1
  meta=$REPLY
  git config --file "$meta" "review.$2" "$3"
}

_wt_review_add_seed() { # $1=worktree $2=relative seeded path
  emulate -L zsh
  local wt=$1 seed=$2 meta existing
  _wt_review_meta "$wt" || return 1
  meta=$REPLY
  for existing in ${(f)"$(git config --file "$meta" --get-all review.seed 2>/dev/null)"}; do
    [[ $existing == $seed ]] && return 0
  done
  git config --file "$meta" --add review.seed "$seed"
}

# Return success when the review worktree differs from the stored PR head. In
# review mode the index starts at the PR head, so this cleanly distinguishes the
# synthetic PR diff (HEAD..index) from edits made by the reviewer.
_wt_review_has_personal_changes() { # $1=worktree $2=PR-head-OID
  emulate -L zsh
  local wt=$1 head=$2 seed_source seed rel allowed
  local -a seeds untracked
  git -C "$wt" diff --ignore-submodules=none --quiet "$head" -- 2>/dev/null || return 0
  git -C "$wt" diff --cached --ignore-submodules=none --quiet "$head" -- 2>/dev/null || return 0

  seed_source=$(_wt_review_get "$wt" seed-source)
  _wt_review_meta "$wt" || return 0
  seeds=(${(f)"$(git config --file "$REPLY" --get-all review.seed 2>/dev/null)"})
  # A seeded path is baseline only while it still exactly matches the source it
  # was copied from. Any edit, deletion, or source drift is retained as personal
  # data rather than being discarded by review refresh/removal.
  for seed in $seeds; do
    [[ -n $seed_source && -e "$seed_source/$seed" && -e "$wt/$seed" ]] || return 0
    diff -qr -- "$seed_source/$seed" "$wt/$seed" >/dev/null 2>&1 || return 0
  done

  # Include ignored files: review cleanup uses --force. Unchanged recorded seed
  # paths are the only untracked content that is safe to treat as baseline.
  untracked=(${(f)"$(git -C "$wt" ls-files --others --directory --no-empty-directory 2>/dev/null)"})
  for rel in $untracked; do
    rel=${rel%/}
    allowed=0
    for seed in $seeds; do
      [[ $rel == $seed || ${rel#$seed/} != $rel ]] && { allowed=1; break; }
    done
    (( allowed )) || return 0
  done
  return 1
}

# Find a configured remote whose URL names OWNER/REPO. Set REPLY to its name.
_wt_remote_for_repo() { # $1=project root $2=owner/repo
  emulate -L zsh
  setopt local_options extended_glob
  local proj=$1 repo=$2 remote url
  REPLY=
  for remote in ${(f)"$(git -C "$proj" remote 2>/dev/null)"}; do
    url=$(git -C "$proj" remote get-url "$remote" 2>/dev/null) || continue
    url=${url%.git}
    if [[ $url == *:${repo} || $url == */${repo} ]]; then
      REPLY=$remote
      return 0
    fi
  done
  return 1
}

# Query a PR and return fields in zsh's conventional $reply array:
# number url state base-branch base-oid head-branch head-oid head-repo
# head-owner cross-repo maintainer-can-modify base-repo base-git-url host
_wt_pr_info() { # $1=project root $2=number-or-url
  emulate -L zsh
  local proj=$1 spec=$2 line rest host base_repo base_git_url
  local -a fields
  line=$(cd "$proj" && gh pr view "$spec" \
    --json number,url,state,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,maintainerCanModify \
    --jq '[.number,.url,.state,.baseRefName,.baseRefOid,.headRefName,.headRefOid,(.headRepository.nameWithOwner // "-"),(.headRepositoryOwner.login // "-"),(.isCrossRepository|tostring),(.maintainerCanModify|tostring)] | @tsv' 2>/dev/null) \
    || { print -u2 "wtreview: could not read PR '$spec' (check gh auth and repository)"; return 1; }
  fields=("${(@ps:\t:)line}")
  (( $#fields == 11 )) || { print -u2 "wtreview: unexpected PR metadata from gh"; return 1; }
  rest=${fields[2]#*://}
  host=${rest%%/*}
  base_repo=${rest#*/}
  base_repo=${base_repo%/pull/*}
  base_git_url="${fields[2]%/pull/*}.git"
  reply=("${fields[@]}" "$base_repo" "$base_git_url" "$host")
}

_wt_review_delete_refs() { # $1=project root $2=PR number
  local failed=0
  git -C "$1" update-ref -d "refs/wt-review/pr-$2/head" 2>/dev/null || failed=1
  git -C "$1" update-ref -d "refs/wt-review/pr-$2/base" 2>/dev/null || failed=1
  return $failed
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
  if _wt_worktree_for_branch "$proj" "$branch"; then
    cd "$REPLY"
    return
  fi
  wtdir="$proj/${branch//\//-}"
  if [[ ! -d "$wtdir" ]]; then
    # Validate an explicit/per-repo manifest before creating anything. _wt_seed
    # returns after parsing when source/destination are empty.
    _wt_seed "" "" "$common" || return 1
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
    _wt_seed "$src" "$wtdir" "$common" || return 1
  fi
  cd "$wtdir"
}

# Review a GitHub PR while making Helix compare its files with the PR merge base.
# The PR itself is staged (HEAD..index); reviewer edits remain unstaged.
wtreview() {
  emulate -L zsh
  local spec=$1
  [[ -z $spec ]] && { print -u2 "usage: wtreview <pr-number|url>"; return 1; }
  (( $+commands[gh] )) || { print -u2 "wtreview: GitHub CLI (gh) is required"; return 1; }

  local common proj
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
    || { print -u2 "wtreview: not inside a git repo"; return 1; }
  proj=${common:h}

  local -a pr
  _wt_pr_info "$proj" "$spec" || return 1
  pr=("${reply[@]}")
  local number=$pr[1] url=$pr[2] state=$pr[3] base_branch=$pr[4] base_oid=$pr[5]
  local head_branch=$pr[6] head_oid=$pr[7] head_repo=$pr[8] head_owner=$pr[9]
  local cross=$pr[10] maintain=$pr[11] base_repo=$pr[12] base_git_url=$pr[13] host=$pr[14]
  local wtdir="$proj/review-pr-$number"
  local head_ref="refs/wt-review/pr-$number/head" base_ref="refs/wt-review/pr-$number/base"
  local base_remote base_source
  local seed_src
  seed_src=$(_wt_review_get "$wtdir" seed-source)
  if [[ -z $seed_src ]]; then
    seed_src=$(git rev-parse --show-toplevel 2>/dev/null)
    [[ $seed_src == $wtdir ]] && seed_src=
    [[ -z $seed_src ]] && seed_src=$(_wt_default_worktree "$common")
  fi
  if _wt_remote_for_repo "$proj" "$base_repo"; then
    base_remote=$REPLY
    base_source=$base_remote
  else
    base_source=$base_git_url
  fi

  print "wtreview: fetching PR #$number ..."
  git -C "$proj" fetch -q "$base_source" \
    "+refs/pull/$number/head:$head_ref" \
    "+refs/heads/$base_branch:$base_ref" \
    || {
      [[ -d $wtdir ]] || _wt_review_delete_refs "$proj" "$number"
      print -u2 "wtreview: failed to fetch PR refs from $base_source"
      return 1
    }
  local fetched_head fetched_base merge_base
  fetched_head=$(git -C "$proj" rev-parse "$head_ref") || return 1
  fetched_base=$(git -C "$proj" rev-parse "$base_ref") || return 1
  [[ $fetched_head == $head_oid ]] \
    || {
      [[ -d $wtdir ]] || _wt_review_delete_refs "$proj" "$number"
      print -u2 "wtreview: PR changed while fetching; rerun the command"
      return 1
    }
  # The base branch may move between the API query and fetch. The fetched tip is
  # authoritative for the comparison, while the queried OID remains metadata.
  merge_base=$(git -C "$proj" merge-base "$head_ref" "$base_ref") \
    || {
      [[ -d $wtdir ]] || _wt_review_delete_refs "$proj" "$number"
      print -u2 "wtreview: could not determine the PR merge base"
      return 1
    }

  if [[ -d $wtdir ]]; then
    local old_url old_head old_merge mode
    mode=$(_wt_review_get "$wtdir" mode)
    old_url=$(_wt_review_get "$wtdir" url)
    old_head=$(_wt_review_get "$wtdir" head)
    old_merge=$(_wt_review_get "$wtdir" merge-base)
    [[ $mode == review && $old_url == $url ]] \
      || { print -u2 "wtreview: $wtdir exists but is not this PR's review worktree"; return 1; }
    if [[ $old_head != $head_oid || $old_merge != $merge_base ]]; then
      if _wt_review_has_personal_changes "$wtdir" "$old_head"; then
        print -u2 "wtreview: PR #$number changed, but the review worktree has personal edits"
        print -u2 "wtreview: run wtchange to keep them, or wtrm -f review-pr-$number to discard them"
        return 1
      fi
      git -C "$wtdir" reset --hard "$head_ref" || return 1
      git -C "$wtdir" reset --soft "$merge_base" || return 1
      print "wtreview: refreshed to ${head_oid[1,12]}"
    fi
  else
    git -C "$proj" worktree add --detach "$wtdir" "$head_ref" || return 1
    git -C "$wtdir" reset --soft "$merge_base" || {
      git -C "$proj" worktree remove --force "$wtdir" 2>/dev/null
      _wt_review_delete_refs "$proj" "$number"
      return 1
    }
  fi

  _wt_review_set "$wtdir" mode review || return 1
  _wt_review_set "$wtdir" number "$number" || return 1
  _wt_review_set "$wtdir" url "$url" || return 1
  _wt_review_set "$wtdir" state "$state" || return 1
  _wt_review_set "$wtdir" head "$head_oid" || return 1
  _wt_review_set "$wtdir" head-branch "$head_branch" || return 1
  _wt_review_set "$wtdir" head-repo "$head_repo" || return 1
  _wt_review_set "$wtdir" head-owner "$head_owner" || return 1
  _wt_review_set "$wtdir" base "$fetched_base" || return 1
  _wt_review_set "$wtdir" base-api "$base_oid" || return 1
  _wt_review_set "$wtdir" base-branch "$base_branch" || return 1
  _wt_review_set "$wtdir" base-repo "$base_repo" || return 1
  _wt_review_set "$wtdir" merge-base "$merge_base" || return 1
  _wt_review_set "$wtdir" cross-repository "$cross" || return 1
  _wt_review_set "$wtdir" maintainer-can-modify "$maintain" || return 1
  _wt_review_set "$wtdir" host "$host" || return 1
  if [[ -n $seed_src && -d $seed_src && $seed_src != $wtdir ]]; then
    _wt_review_set "$wtdir" seed-source "$seed_src" || return 1
    _wt_seed "$seed_src" "$wtdir" "$common" || return 1
    local seeded
    for seeded in "${reply[@]}"; do _wt_review_add_seed "$wtdir" "$seeded" || return 1; done
  fi

  cd "$wtdir"
  print "wtreview: PR #$number ($head_owner:$head_branch)"
  print "  review mode: PR changes are staged and visible against ${merge_base[1,12]}"
  print "  your edits:  git diff"
  print "  edit/push:   wtchange"
}

# Convert the current synthetic review checkout into the real PR branch without
# touching the index or worktree, preserving reviewer edits and staging.
wtchange() {
  emulate -L zsh
  local wt common proj mode
  wt=$(git rev-parse --show-toplevel 2>/dev/null) \
    || { print -u2 "wtchange: not inside a worktree"; return 1; }
  mode=$(_wt_review_get "$wt" mode)
  [[ $mode == review ]] || { print -u2 "wtchange: current worktree is not in review mode"; return 1; }
  common=$(git -C "$wt" rev-parse --path-format=absolute --git-common-dir) || return 1
  proj=${common:h}

  local number url head_oid head_branch head_repo head_owner merge_base maintain host
  number=$(_wt_review_get "$wt" number)
  url=$(_wt_review_get "$wt" url)
  head_oid=$(_wt_review_get "$wt" head)
  head_branch=$(_wt_review_get "$wt" head-branch)
  head_repo=$(_wt_review_get "$wt" head-repo)
  head_owner=$(_wt_review_get "$wt" head-owner)
  merge_base=$(_wt_review_get "$wt" merge-base)
  maintain=$(_wt_review_get "$wt" maintainer-can-modify)
  host=$(_wt_review_get "$wt" host)
  [[ -n $number && -n $head_oid && -n $head_branch && $head_repo != - ]] \
    || { print -u2 "wtchange: incomplete PR metadata (the fork may have been deleted)"; return 1; }
  [[ $(git -C "$wt" rev-parse HEAD 2>/dev/null) == $merge_base ]] \
    || { print -u2 "wtchange: review HEAD changed unexpectedly; refusing to rewrite it"; return 1; }
  # Validate the configured seed manifest before changing refs or branch state.
  _wt_seed "" "" "$common" || return 1

  local remote remote_url origin_url remote_ref remote_oid
  if _wt_remote_for_repo "$proj" "$head_repo"; then
    remote=$REPLY
  else
    remote="pr-$number-${head_owner//[^A-Za-z0-9._-]/-}"
    if git -C "$proj" remote get-url "$remote" >/dev/null 2>&1; then
      print -u2 "wtchange: remote '$remote' already exists for another repository"
      return 1
    fi
    origin_url=$(git -C "$proj" remote get-url origin 2>/dev/null)
    if [[ $origin_url == *@*:* ]]; then
      remote_url="${origin_url%%:*}:$head_repo.git"
    elif [[ $origin_url == ssh://* ]]; then
      local ssh_authority=${${origin_url#ssh://}%%/*}
      remote_url="ssh://$ssh_authority/$head_repo.git"
    else
      remote_url="https://$host/$head_repo.git"
    fi
    git -C "$proj" remote add "$remote" "$remote_url" || return 1
    print "wtchange: added remote $remote -> $head_repo"
  fi
  remote_ref="refs/remotes/$remote/$head_branch"
  git -C "$proj" fetch -q "$remote" "+refs/heads/$head_branch:$remote_ref" \
    || { print -u2 "wtchange: could not fetch $remote/$head_branch"; return 1; }
  remote_oid=$(git -C "$proj" rev-parse "$remote_ref") || return 1
  [[ $remote_oid == $head_oid ]] || {
    print -u2 "wtchange: the PR branch advanced from ${head_oid[1,12]} to ${remote_oid[1,12]}"
    print -u2 "wtchange: rerun wtreview $url to review the new head before changing it"
    return 1
  }

  if git -C "$proj" show-ref -q --verify "refs/heads/$head_branch"; then
    [[ $(git -C "$proj" rev-parse "refs/heads/$head_branch") == $head_oid ]] \
      || { print -u2 "wtchange: local branch '$head_branch' exists at a different commit"; return 1; }
    if _wt_worktree_for_branch "$proj" "$head_branch" && [[ $REPLY != $wt ]]; then
      print -u2 "wtchange: local branch '$head_branch' is already checked out at $REPLY"
      return 1
    fi
  else
    git -C "$proj" branch "$head_branch" "$head_oid" || return 1
  fi
  git -C "$proj" branch --set-upstream-to="$remote/$head_branch" "$head_branch" >/dev/null || return 1

  # HEAD moves from merge-base to PR head. --soft deliberately preserves the PR
  # index and all reviewer edits; attaching by symbolic-ref avoids a checkout.
  git -C "$wt" reset --soft "$head_oid" || return 1
  git -C "$wt" symbolic-ref HEAD "refs/heads/$head_branch" || return 1
  _wt_review_set "$wt" mode change || return 1
  _wt_review_delete_refs "$proj" "$number" \
    || print -u2 "wtchange: warning: could not remove temporary review refs for PR #$number"

  local src
  src=$(_wt_default_worktree "$common")
  [[ $src == $wt ]] && src=
  _wt_seed "$src" "$wt" "$common" || return 1

  print "wtchange: PR #$number is now branch '$head_branch' tracking $remote/$head_branch"
  [[ $head_owner != $(gh api user --jq .login 2>/dev/null) && $maintain != true ]] \
    && print -u2 "wtchange: warning: the contributor disabled maintainer edits; pushing may be rejected"
  print "  PR baseline removed; only your additional edits remain in git status/Helix"
}

# remove a worktree
wtrm() {
  emulate -L zsh
  local force=0
  [[ $1 == (-f|--force) ]] && { force=1; shift; }
  local arg="$1"
  [[ -z "$arg" ]] && { print -u2 "usage: wtrm [-f|--force] <branch|worktree>"; return 1; }
  local common proj target mode head number
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
    || { print -u2 "wtrm: not inside a git repo"; return 1; }
  proj=${common:h}
  _wt_worktree_for_arg "$proj" "$arg"
  local found=$?
  if (( found == 2 )); then
    print -u2 "wtrm: '$arg' matches both a branch and a worktree directory; use the absolute path"
    return 1
  elif (( found != 0 )); then
    print -u2 "wtrm: no worktree found for '$arg'"
    return 1
  fi
  target=$REPLY
  mode=$(_wt_review_get "$target" mode)
  if [[ $mode == review ]]; then
    head=$(_wt_review_get "$target" head)
    number=$(_wt_review_get "$target" number)
    if (( ! force )) && _wt_review_has_personal_changes "$target" "$head"; then
      print -u2 "wtrm: review-pr-$number has personal edits; run wtchange or use wtrm -f $arg"
      return 1
    fi
    git -C "$proj" worktree remove --force "$target" || return 1
    _wt_review_delete_refs "$proj" "$number" \
      || print -u2 "wtrm: warning: could not remove temporary review refs for PR #$number"
  else
    local -a opts
    (( force )) && opts+=(--force)
    git -C "$proj" worktree remove $opts "$target" || return 1
  fi
  print "removed ${target:t}"
}

# list worktrees
wtls() { git worktree list; }

# Is <branch> merged? Used by `wtprune --merged`. Sets $REPLY to a short reason.
# GITHUB ONLY: asks gh for a MERGED PR whose merged commit (headRefOid) EQUALS the
# branch tip. The exact-SHA match matters for two reasons:
#   - name reuse: a recycled branch name must not match an OLD merged PR; and
#   - we deliberately do NOT use ancestry (`git branch --merged` / is-ancestor of
#     origin/HEAD). A brand-new branch with no commits is trivially an ancestor of
#     origin/HEAD, so ancestry can't tell an empty new branch from a merged one and
#     would delete fresh work. A merged PR matched by SHA is the only safe signal.
_wtprune_merged() { # $1=proj  $2=gh_ok  $3=branch  $4=worktree
  emulate -L zsh
  local proj=$1 gh_ok=$2 b=$3 wt=$4 tip pr url mode
  (( gh_ok )) || return 1
  tip=$(git -C "$proj" rev-parse "refs/heads/$b" 2>/dev/null) || return 1
  mode=$(_wt_review_get "$wt" mode)
  url=$(_wt_review_get "$wt" url)
  if [[ $mode == change && -n $url ]]; then
    pr=$(cd "$proj" && gh pr view "$url" --json number,state,headRefOid \
      --jq "select(.state==\"MERGED\" and .headRefOid==\"$tip\") | .number" 2>/dev/null)
  else
    pr=$(cd "$proj" && gh pr list --head "$b" --state merged --json number,headRefOid \
      --jq ".[] | select(.headRefOid==\"$tip\") | .number" 2>/dev/null | head -1)
  fi
  [[ -n $pr ]] && { REPLY="merged PR #$pr"; return 0; }
  return 1
}

# Is a detached synthetic review worktree's exact PR head now merged? Return 2
# when merged but carrying personal edits, so callers can explain why it stays.
_wtprune_review_merged() { # $1=project root $2=gh_ok $3=worktree
  emulate -L zsh
  local proj=$1 gh_ok=$2 wt=$3 mode url head number pr
  (( gh_ok )) || return 1
  mode=$(_wt_review_get "$wt" mode)
  [[ $mode == review ]] || return 1
  url=$(_wt_review_get "$wt" url)
  head=$(_wt_review_get "$wt" head)
  number=$(_wt_review_get "$wt" number)
  pr=$(cd "$proj" && gh pr view "$url" --json number,state,headRefOid \
    --jq "select(.state==\"MERGED\" and .headRefOid==\"$head\") | .number" 2>/dev/null)
  [[ -n $pr ]] || return 1
  if _wt_review_has_personal_changes "$wt" "$head"; then
    REPLY="review-pr-$number has personal edits"
    return 2
  fi
  REPLY="merged PR #$pr (review mode)"
  return 0
}

# Remove worktrees you're done with. By DEFAULT that means the branch's upstream
# was DELETED on the remote ("gone"): you were tracking origin/<b> and it's now
# gone. Branches that never recorded an upstream are LEFT ALONE (they may be new
# local work you haven't pushed). Runs `git fetch --prune` first (skip -n) so the
# gone status is fresh, lists the matches, then confirms before removing.
#
# With -m/--merged it ALSO removes worktrees whose branch was MERGED via a PR,
# including clean detached `wtreview` worktrees. Review worktrees with personal
# edits are always retained. Detection is GitHub-only and matches the exact PR
# head SHA; no ancestry check is used because a new empty branch is trivially an
# ancestor of the default branch.
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
    print "wtprune: git fetch --all --prune ..."
    git -C "$proj" fetch --all --prune --quiet \
      || print -u2 "wtprune: fetch failed; continuing with cached remote-tracking refs"
  fi

  # Default branch (origin/HEAD short name): never a removal candidate itself.
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
      print -u2 "wtprune: --merged needs gh (GitHub CLI); without it, only deleted-remote branches are removed"
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
          targets+=$wtpath
          why[$wtpath]="remote branch deleted"
        elif (( merged )) && _wtprune_merged "$proj" "$gh_ok" "$b" "$wtpath"; then
          targets+=$wtpath
          why[$wtpath]=$REPLY
        fi
        ;;
    esac
  done

  # Detached review worktrees have no `branch` porcelain record, so inspect
  # their private metadata in a separate pass. They are candidates only under
  # --merged and only if they still exactly match the reviewed PR head.
  if (( merged )); then
    local review_result
    for line in ${(f)"$(git -C "$proj" worktree list --porcelain 2>/dev/null)"}; do
      [[ $line == "worktree "* ]] || continue
      wtpath=${line#worktree }
      [[ -n $curwt && $wtpath == $curwt ]] && continue
      _wtprune_review_merged "$proj" "$gh_ok" "$wtpath"
      review_result=$?
      if (( review_result == 0 )); then
        targets+=$wtpath
        why[$wtpath]=$REPLY
      elif (( review_result == 2 )); then
        print -u2 "wtprune: skipping $REPLY -- run wtchange or remove it explicitly"
      fi
    done
  fi

  if (( ! $#targets )); then
    print "wtprune: nothing to remove."
    return 0
  fi

  print "wtprune: worktrees to remove:"
  local t
  for t in $targets; do printf '  %-38s (%s)\n' "${t:t}" "${why[$t]}"; done
  if (( ! yes )); then
    print -n "remove them? [y/N] "
    local reply; read -r reply
    [[ $reply == [yY]* ]] || { print "aborted"; return 1; }
  fi

  local failed=0
  for t in $targets; do wtrm "$t" || failed=1; done
  return $failed
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
                         seeds local files configured by $WT_SEED, the common-dir
                         wt-seed manifest, or $WT_SEED_FILE)
  wtreview <pr>         create/reuse review-pr-<number> for a GitHub PR;
                        highlights PR changes and seeds local files (needs gh)
  wtchange              convert the current review worktree to the real PR
                        branch; preserves edits, sets upstream, and seeds files
  wtrm [-f] <name>      remove by branch or worktree name; clean synthetic
                        reviews are removed safely, -f discards personal edits
  wtprune [-ynm]        remove worktrees whose remote branch was deleted ("gone");
                        leaves branches that never had a remote. -n skips fetch --prune;
                        -m/--merged also removes branches and clean review
                        worktrees merged via a PR (GitHub only; exact head SHA)
  wtls                  list worktrees
  wtconvert [-y]        convert a normal clone (CWD) into the bare/worktree layout
                        (needs a clean tree; keeps ignored files; stashes survive)
  <common-dir>/wt-seed  one relative path/glob per line; replaces $WT_SEED
  WT_SEED_FILE=<path>   use an explicit seed manifest for the next `wt`
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

# Complete `wtreview` with open PR numbers and descriptions (GitHub only).
_wtreview() {
  local -a prs
  (( $+commands[gh] )) || return 0
  prs=(${(f)"$(gh pr list --state open --json number,title,headRefName \
    --jq '.[] | "\(.number):\(.headRefName) — \(.title)"' 2>/dev/null)"})
  _describe 'pull request' prs
}
(( $+functions[compdef] )) && compdef _wtreview wtreview

# Complete `wtrm` with existing worktree directory and branch names.
_wtrm() {
  local -a values
  local line wtpath
  for line in ${(f)"$(git worktree list --porcelain 2>/dev/null)"}; do
    case $line in
      ("worktree "*) wtpath=${line#worktree }; values+=(${wtpath:t}) ;;
      ("branch refs/heads/"*) values+=(${line#branch refs/heads/}) ;;
    esac
  done
  compadd -- -f --force
  compadd -a -- ${(u)values:#.bare}
}
(( $+functions[compdef] )) && compdef _wtrm wtrm

# complete `wtprune` with its flags
_wtprune() { compadd -- -y --yes -n --no-fetch -m --merged; }
(( $+functions[compdef] )) && compdef _wtprune wtprune

true  # ensure the plugin always sources with a success status
