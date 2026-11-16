# worktree.zsh
# Git worktree commands: short names for `ade worktree` that also cd where it
# says (`wthelp` lists every option).
#
#   wtclone <url> [dir]   clone a repository laid out for worktrees
#   wt <branch> [base]    cd into the branch's worktree, making it if needed;
#                         -s stays and prints its path, -t goes to its tab,
#                         -b opens the tab in the background, -p PROMPT opens
#                         a background tab whose agent starts on PROMPT
#   wtrm [-f] <name>      remove a worktree and close its tabs, except yours
#   wtprune [-ynm]        remove the worktrees whose remote branch was deleted
#                         (-m: also those merged through a GitHub PR)
#   wtls                  list the worktrees
#   wtconvert [-y]        turn the normal clone you are in into the configured
#                         layout, and cd into it
#   wthelp                show every option
#
# They run `ade` from PATH (install.sh links it). ADE_SEED (the seed
# patterns) may be a zsh array here.

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
    command env "${env_args[@]}" ade worktree --cwd-file "$cwd_file" "$@"
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
  command ade worktree help
}

# ---- completions -------------------------------------------------------------
# shell/init.zsh runs `compinit` before the ~/.zshrc block sources this file, so
# `compdef` already exists here. `compdef _fn cmd` registers: "to complete `cmd`,
# run the shell function `_fn`". Inside _fn we build an array of candidates and
# hand them to `compadd`, which shows/inserts them.

# Complete `wt`'s -s/-t/-b/-p/--session options. Returns 0 when the current
# word was one of them (or the prompt or conversation ID after one).
_wt_landing_options() {
  case ${words[CURRENT-1]} in
    (-p|--prompt) _message 'prompt for OpenCode'; return 0 ;;
    (--session) _message 'OpenCode conversation ID'; return 0 ;;
  esac
  [[ $PREFIX == -* ]] || return 1
  compadd -- -s --stay -t --tab -b --background -p --prompt --session
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
