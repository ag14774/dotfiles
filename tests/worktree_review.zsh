#!/usr/bin/env zsh

set -eu

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
trap 'rm -rf "$TMP"' EXIT

fail() {
  print -u2 "FAIL: $*"
  exit 1
}

assert_eq() {
  [[ $1 == $2 ]] || fail "expected '$2', got '$1'"
}

mkdir -p "$TMP/bin" "$TMP/acme"
cat > "$TMP/bin/gh" <<'EOF'
#!/usr/bin/env zsh
if [[ $1 == pr && $2 == view ]]; then
  if [[ " $* " == *"number,url,state,baseRefName"* ]]; then
    printf '%s\thttps://github.com/acme/demo/pull/%s\t%s\tmain\t%s\tfeature/review\t%s\t%s\t%s\t%s\t%s\n' \
      "$GH_PR_NUMBER" "$GH_PR_NUMBER" "$GH_PR_STATE" "$GH_BASE_OID" "$GH_HEAD_OID" \
      "$GH_HEAD_REPO" "$GH_HEAD_OWNER" "$GH_CROSS_REPO" "$GH_MAINTAIN"
  elif [[ $GH_PR_STATE == MERGED ]]; then
    print -r -- "$GH_PR_NUMBER"
  fi
elif [[ $1 == pr && $2 == list ]]; then
  [[ $GH_PR_STATE == MERGED ]] && print -r -- "$GH_PR_NUMBER"
elif [[ $1 == api && $2 == user ]]; then
  print -r -- reviewer
else
  exit 1
fi
EOF
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH"

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
export GH_BASE_OID=$(git -C "$seed" rev-parse HEAD)

git -C "$seed" switch -qc feature/review
print 'feature' >> "$seed/app.txt"
print 'new file' > "$seed/new.txt"
git -C "$seed" add app.txt new.txt
git -C "$seed" commit -qm feature
export GH_HEAD_OID=$(git -C "$seed" rev-parse HEAD)
git -C "$seed" push -q origin feature/review
git -C "$seed" push -q origin HEAD:refs/pull/7/head HEAD:refs/pull/8/head

source "$ROOT/shell/worktree.zsh"
source "$ROOT/shell/git.zsh"

cd "$TMP"
wtclone "$remote" project >/dev/null
cd "$project"
wt main >/dev/null
print 'seeded secret' > .env
cd "$project"

export GH_HEAD_REPO=acme/demo GH_HEAD_OWNER=contributor GH_CROSS_REPO=false GH_MAINTAIN=true
export GH_PR_NUMBER=7 GH_PR_STATE=OPEN
wtreview 7 >/dev/null
assert_eq "$PWD" "$project/review-pr-7"
assert_eq "$(git rev-parse HEAD)" "$GH_BASE_OID"
assert_eq "$(git show :app.txt)" $'base\nfeature'
git diff --quiet || fail "review worktree should match the PR-head index"
git diff --cached --quiet && fail "PR baseline should be staged against the merge base"

print 'reviewer edit' >> app.txt
wtchange >/dev/null
assert_eq "$(git symbolic-ref --short HEAD)" feature/review
assert_eq "$(git rev-parse '@{upstream}')" "$GH_HEAD_OID"
[[ -f .env ]] || fail "wtchange should seed local files"
git diff --quiet && fail "reviewer edit should survive wtchange"
git diff --cached --quiet || fail "original PR baseline should disappear after wtchange"
assert_eq "$(_wt_review_get "$PWD" mode)" change

cd "$project/main"
wt feature/review
assert_eq "$PWD" "$project/review-pr-7"
cd "$project/main"
wtrm -f feature/review >/dev/null
[[ ! -d $project/review-pr-7 ]] || fail "branch-aware wtrm should remove the changed review worktree"

# A fork PR should retain its original contributor remote as the branch upstream.
mkdir -p "$TMP/contributor"
fork_remote="$TMP/contributor/fork.git"
git init -q --bare "$fork_remote"
git -C "$seed" push -q "$fork_remote" HEAD:refs/heads/feature/review
git -C "$seed" push -q origin HEAD:refs/pull/9/head
git -C "$project" remote add contributor "$fork_remote"
export GH_HEAD_REPO=contributor/fork GH_HEAD_OWNER=contributor GH_CROSS_REPO=true GH_MAINTAIN=true
export GH_PR_NUMBER=9 GH_PR_STATE=OPEN
cd "$project/main"
wtreview 9 >/dev/null
wtchange >/dev/null
assert_eq "$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')" contributor/feature/review
# A pruned tracking ref must not make ggpush fall back to origin.
git --git-dir="$remote" update-ref -d refs/heads/feature/review
git -C "$project" update-ref -d refs/remotes/contributor/feature/review
ggpush >/dev/null
git --git-dir="$remote" show-ref -q --verify refs/heads/feature/review \
  && fail "ggpush should keep using the configured fork when its tracking ref is missing"
git --git-dir="$fork_remote" show-ref -q --verify refs/heads/feature/review \
  || fail "ggpush should target the configured contributor fork"
git --git-dir="$fork_remote" update-ref -d refs/heads/feature/review
git -C "$project" fetch -q --prune contributor
cd "$project/main"
wtprune -n -y >/dev/null
[[ ! -d $project/review-pr-9 ]] || fail "wtprune should remove a changed review whose upstream was deleted"

export GH_HEAD_REPO=acme/demo GH_HEAD_OWNER=contributor GH_CROSS_REPO=false GH_MAINTAIN=true
export GH_PR_NUMBER=8 GH_PR_STATE=OPEN
cd "$project/main"
wtreview 8 >/dev/null
if ggpush >/dev/null 2>&1; then
  fail "ggpush should refuse detached review mode"
fi
print 'personal note' > scratch.txt
cd "$project/main"
if wtrm review-pr-8 >/dev/null 2>&1; then
  fail "wtrm should refuse a review worktree with personal edits"
fi
rm "$project/review-pr-8/scratch.txt"

export GH_PR_STATE=MERGED
wtprune -n -m -y >/dev/null
[[ ! -d $project/review-pr-8 ]] || fail "wtprune --merged should remove a clean merged review worktree"
git -C "$project" show-ref -q --verify refs/wt-review/pr-8/head \
  && fail "review refs should be deleted with the worktree"

print "worktree review tests: ok"
