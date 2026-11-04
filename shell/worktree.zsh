# worktree.plugin.zsh
# Bare-repo + git worktree helpers for parallel development.
#
# Commands:
#   wtclone <url> [dir]   set up a bare repo + worktree layout from a remote
#   wt <branch> [base]    create/reuse a worktree for <branch> and cd into it
#                         (seeds configured local files into new worktrees;
#                         -s stays, -t/-b open its Zellij tab, -p prompts OpenCode)
#   wtreview <pr>         review a GitHub PR with its changes visible in Helix
#                         (same -s/-t/-b/-p options as wt)
#   wtchange              turn the current review worktree into the PR branch
#   wtrm [-f] <name>      remove a worktree by branch or directory name (and the
#                         tabs whose panes are all inside it)
#   wtprune [-ynm]        wtrm worktrees whose remote branch was deleted ("gone");
#                         -m also removes merged branches/clean PR reviews (via gh)
#   wtls                  list worktrees
#   wtconvert [-y]        convert a normal clone (CWD) into this bare/worktree layout
#   wthelp                show help for these commands
#
# The layout and implementation live in config/.local/bin/wt-core, which stow
# also puts on PATH for scripts, Zellij and agents. These functions are thin
# wrappers: they run this checkout's copy of the engine, forward the seed
# settings, and perform any `cd` the engine reports in your shell.

typeset -g _WT_CORE=${${(%):-%x}:A:h:h}/config/.local/bin/wt-core

# Run a wt-core command. WT_SEED may be a zsh array (not exportable), so it is
# passed newline-separated; WT_SEED_FILE may be an unexported shell variable.
_wt_core() {
  emulate -L zsh
  local cwd_file dir rc
  local -a env_args
  (( ${+WT_SEED} )) && env_args+=("WT_SEED=${(pj:\n:)WT_SEED}")
  (( ${+WT_SEED_FILE} )) && env_args+=("WT_SEED_FILE=$WT_SEED_FILE")
  cwd_file=$(mktemp "${TMPDIR:-/tmp}/wt-cwd.XXXXXX") || return 1
  {
    command env "${env_args[@]}" "$_WT_CORE" --cwd-file "$cwd_file" "$@"
    rc=$?
    dir=$(<"$cwd_file")
  } always {
    command rm -f -- "$cwd_file"
  }
  if [[ -n $dir ]]; then
    cd "$dir" || return
  fi
  return rc
}

wtclone() { _wt_core clone "$@"; }
wt() { _wt_core open "$@"; }
wtreview() { _wt_core review "$@"; }
wtchange() { _wt_core change "$@"; }
wtrm() { _wt_core rm "$@"; }
wtls() { _wt_core ls; }
wtprune() { _wt_core prune "$@"; }
wtconvert() { _wt_core convert "$@"; }

# show help for the worktree commands
wthelp() {
  emulate -L zsh
  print -r -- 'worktree commands (bare repo + git worktrees):
  wtclone <url> [dir]   bare-clone a repo and set it up for worktrees
  wt <branch> [base]    create/reuse a worktree for <branch> and cd into it
                        (base defaults to origin/HEAD; tab-completes branches;
                         seeds local files configured by $WT_SEED, the common-dir
                         wt-seed manifest, or $WT_SEED_FILE)
     -s                 stay here instead and print the worktree path
     -t                 focus its Zellij tab, opening one (with OpenCode) if needed
     -b                 open its tab in the background; your focus stays here
     -p PROMPT          start OpenCode in a new background tab with PROMPT
                        (outside Zellij: -t changes directory, -b stays, -p fails)
  wtreview <pr>         create/reuse review-pr-<number> for a GitHub PR;
                        highlights PR changes and seeds local files (needs gh);
                        takes the same -s/-t/-b/-p options as wt
  wtchange              convert the current review worktree to the real PR
                        branch; preserves edits, sets upstream, and seeds files
  wtrm [-f] <name>      remove by branch or worktree name; clean synthetic
                        reviews are removed safely, -f discards personal edits;
                        also closes tabs whose panes are all inside the
                        worktree (never the tab you run it from)
  wtprune [-ynm]        remove worktrees whose remote branch was deleted ("gone");
                        leaves branches that never had a remote. -n skips fetch --prune;
                        -m/--merged also removes branches and clean review
                        worktrees merged via a PR (GitHub only; exact head SHA);
                        closes their tabs like wtrm; without -y it needs a terminal
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

# Complete the -s/-t/-b/-p options shared by `wt` and `wtreview`. Returns 0 when
# the current word was one of them (or the free-text prompt after -p).
_wt_landing_options() {
  if [[ ${words[CURRENT-1]} == (-p|--prompt) ]]; then
    _message 'prompt for OpenCode'
    return 0
  fi
  [[ $PREFIX == -* ]] || return 1
  compadd -- -s --stay -t --tab -b --background -p --prompt
}

# complete `wt` with local + origin/* branch names
_wt() {
  _wt_landing_options && return
  local -a branches
  branches=(${(f)"$(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes/origin 2>/dev/null)"})
  branches=(${branches:#origin/HEAD})   # drop the origin/HEAD symref first...
  branches=(${branches#origin/})        # ...then strip the "origin/" prefix
  compadd -a -- ${(u)branches}          # (u) = keep unique names only
}
(( $+functions[compdef] )) && compdef _wt wt

# Complete `wtreview` with open PR numbers and descriptions (GitHub only).
_wtreview() {
  _wt_landing_options && return
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
