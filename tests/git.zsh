#!/usr/bin/env zsh
# ggpush and ggpull (shell/git.zsh) use the branch's upstream (here a
# contributor's fork), even when its tracking ref was pruned, and refuse a
# detached HEAD.

set -eu

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
trap 'rm -rf "$TMP"' EXIT
fail() {
  print -u2 "FAIL: $*"
  exit 1
}
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
source "$ROOT/shell/git.zsh"

remote=$TMP/origin.git
fork=$TMP/contributor/topic.git
git init -q -b main --bare "$remote"
git init -q -b main --bare "$fork"
git init -q -b main "$TMP/seed"
git -C "$TMP/seed" commit -q --allow-empty -m base
git -C "$TMP/seed" push -q "$remote" main
git -C "$TMP/seed" push -q "$fork" main:refs/heads/fork-topic

git clone -q "$remote" "$TMP/clone"
cd "$TMP/clone"
git remote add fork "$fork"
git fetch -q fork
git switch -q --track -c fork-topic fork/fork-topic
git --git-dir="$fork" update-ref -d refs/heads/fork-topic
git update-ref -d refs/remotes/fork/fork-topic

ggpush >/dev/null 2>&1 || fail "ggpush to the fork failed"
git --git-dir="$fork" show-ref -q --verify refs/heads/fork-topic || fail "ggpush should push to the configured fork"
git --git-dir="$remote" show-ref -q --verify refs/heads/fork-topic && fail "ggpush should not fall back to origin"
git switch -q --detach
if ggpush >/dev/null 2>&1; then fail "ggpush should refuse a detached HEAD"; fi
if ggpull >/dev/null 2>&1; then fail "ggpull should refuse a detached HEAD"; fi
print "git test: ok"
