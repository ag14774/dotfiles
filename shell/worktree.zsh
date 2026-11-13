# worktree.zsh
# Git worktree helpers for parallel development: short names for
# `ade worktree` (packages/ade-kit/src/worktree-cli.ts) that also `cd` where it
# reports.
#
#   wtclone <url> [dir]   ade worktree clone
#   wt <branch> [base]    ade worktree open (cds into the worktree; -s stays,
#                         -t/-b open its tab, -p starts the agent on a prompt)
#   wtrm [-f] <name>      ade worktree rm
#   wtprune [-ynm]        ade worktree prune
#   wtls                  ade worktree ls
#   wtconvert [-y]        ade worktree convert
#   wthelp                ade worktree help
#
# They run this checkout's ade. ADE_SEED may be a zsh array here.

typeset -g _WT_ADE=${${(%):-%x}:A:h:h}/config/.local/bin/ade

# Run an `ade worktree` command, then cd where it says. ADE_SEED may be a zsh
# array (not exportable), so it is passed newline-separated; ADE_SEED_FILE may
# be an unexported shell variable.
_wt_ade() {
  emulate -L zsh
  local cwd_file dir rc
  local -a env_args
  (( ${+ADE_SEED} )) && env_args+=("ADE_SEED=${(pj:\n:)ADE_SEED}")
  (( ${+ADE_SEED_FILE} )) && env_args+=("ADE_SEED_FILE=$ADE_SEED_FILE")
  cwd_file=$(mktemp "${TMPDIR:-/tmp}/wt-cwd.XXXXXX") || return 1
  {
    command env "${env_args[@]}" "$_WT_ADE" worktree --cwd-file "$cwd_file" "$@"
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

wtclone() { _wt_ade clone "$@"; }
wt() { _wt_ade open "$@"; }
wtrm() { _wt_ade rm "$@"; }
wtls() { _wt_ade ls "$@"; }
wtprune() { _wt_ade prune "$@"; }
wtconvert() { _wt_ade convert "$@"; }
wthelp() {
  print -r -- 'wtclone, wt, wtrm, wtls, wtprune and wtconvert run ade worktree clone, open,
rm, ls, prune and convert, and cd where it reports (wt without -s/-t/-b/-p).
'
  "$_WT_ADE" worktree help
}

# ---- completions -------------------------------------------------------------
# shell/init.zsh runs `compinit` before the ~/.zshrc block sources this file, so
# `compdef` already exists here. `compdef _fn cmd` registers: "to complete `cmd`,
# run the shell function `_fn`". Inside _fn we build an array of candidates and
# hand them to `compadd`, which shows/inserts them.

# Complete `wt`'s -s/-t/-b/-p options. Returns 0 when the current word was one
# of them (or the free-text prompt after -p).
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
