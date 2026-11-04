#!/usr/bin/env zsh

set -eu

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
trap 'rm -rf "$TMP"' EXIT
# Tab tests set these against a fake zellij; never touch a real session.
unset ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID

fail() {
  print -u2 "FAIL: $*"
  exit 1
}

assert_eq() {
  [[ $1 == $2 ]] || fail "expected '$2', got '$1'"
}

review_mode() {
  git config --file "$(git rev-parse --path-format=absolute --git-dir)/wt-review" --get review.mode
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

# Stand-in for the `zellij action` calls wt-core makes. State lives in $ZJ_STATE:
# tabs (id, name), panes (id, tab, title, cwd, command) and the focused tab.
cat > "$TMP/bin/zellij" <<'EOF'
#!/usr/bin/env zsh
st=$ZJ_STATE
[[ $1 == action ]] || exit 1
cmd=$2
shift 2
next_id() { local n=$(<$st/next); print $(( n + 1 )) > $st/next; print $n; }
case $cmd in
  new-tab)
    name= cwd=$PWD focus=1
    while (( $# )); do
      case $1 in --name) name=$2; shift ;; --cwd) cwd=$2; shift ;; --no-focus) focus=0 ;; esac
      shift
    done
    tab=$(next_id)
    printf '%s\t%s\n' $tab $name >> $st/tabs
    printf '%s\t%s\tmain\t%s\t-\n' $(next_id) $tab $cwd >> $st/panes
    printf '%s\t%s\topencode\t%s\tzsh -i -c opencode\n' $(next_id) $tab $cwd >> $st/panes
    (( focus )) && print $tab > $st/focus
    print $tab
    ;;
  list-panes)
    jq -Rn --rawfile tabs $st/tabs '
      ($tabs | split("\n") | map(select(length > 0) | split("\t") | {key: .[0], value: .[1]})
        | from_entries) as $names
      | [inputs | split("\t") | {id: (.[0] | tonumber), tab_id: (.[1] | tonumber),
          tab_name: $names[.[1]], title: .[2], terminal_command: .[4],
          pane_cwd: (if .[3] == "" then null else .[3] end),
          is_plugin: false}]' < $st/panes
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
        --name) name=$2; shift ;;
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

# Called directly, the engine prints only the worktree path on stdout (progress,
# such as seeding .env, goes to stderr).
cd "$project/main"
out=$("$ROOT/config/.local/bin/wt-core" open direct 2>/dev/null)
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

export GH_HEAD_REPO=acme/demo GH_HEAD_OWNER=contributor GH_CROSS_REPO=false GH_MAINTAIN=true
export GH_PR_NUMBER=7 GH_PR_STATE=OPEN
wtreview 7 >/dev/null
assert_eq "$PWD" "$project/review-pr-7"
assert_eq "$(git rev-parse HEAD)" "$GH_BASE_OID"
assert_eq "$(git show :app.txt)" $'base\nfeature'
assert_eq "$(<.env)" 'seeded secret'
git diff --quiet || fail "review worktree should match the PR-head index"
git diff --cached --quiet && fail "PR baseline should be staged against the merge base"

print 'reviewer edit' >> app.txt
wtchange >/dev/null
assert_eq "$(git symbolic-ref --short HEAD)" feature/review
assert_eq "$(git rev-parse '@{upstream}')" "$GH_HEAD_OID"
[[ -f .env ]] || fail "wtchange should seed local files"
git diff --quiet && fail "reviewer edit should survive wtchange"
git diff --cached --quiet || fail "original PR baseline should disappear after wtchange"
assert_eq "$(review_mode)" change

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
# Without a terminal to confirm (as for an agent), wtprune refuses to prompt.
if wtprune -n </dev/null >/dev/null 2>&1; then fail "wtprune without -y should need a terminal"; fi
[[ -d $project/review-pr-9 ]] || fail "an unconfirmed wtprune should remove nothing"
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
print 'changed secret' > "$project/review-pr-8/.env"
if wtrm review-pr-8 >/dev/null 2>&1; then
  fail "wtrm should refuse a review worktree with a modified seed file"
fi
print 'seeded secret' > "$project/review-pr-8/.env"

export GH_PR_STATE=MERGED
wtprune -n -m -y >/dev/null
[[ ! -d $project/review-pr-8 ]] || fail "wtprune --merged should remove a clean merged review worktree"
git -C "$project" show-ref -q --verify refs/wt-review/pr-8/head \
  && fail "review refs should be deleted with the worktree"

# --- Zellij tabs, against the fake zellij: the caller is pane 1 in tab 1. ---
export ZJ_STATE=$TMP/zj ZELLIJ=0 ZELLIJ_SESSION_NAME=test ZELLIJ_PANE_ID=1
mkdir -p "$ZJ_STATE"
print 2 > "$ZJ_STATE/next"
printf '1\thome\n' > "$ZJ_STATE/tabs"
printf '1\t1\tmain\t%s\t-\n' "$TMP" > "$ZJ_STATE/panes"
print 1 > "$ZJ_STATE/focus"
cd "$project/main"

tab_count() { print ${#${(f)"$(<"$ZJ_STATE/tabs")"}}; }
renumber_tab() { # $1=old ID $2=new ID, as a resurrected session does
  awk -F'\t' -v OFS='\t' -v o="$1" -v n="$2" '$1 == o { $1 = n } 1' "$ZJ_STATE/tabs" \
    > "$ZJ_STATE/new" && mv "$ZJ_STATE/new" "$ZJ_STATE/tabs"
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
printf '60\t%s\tlogs\t\t-\n' "$tab" >> "$ZJ_STATE/panes"
zellij action go-to-tab-by-id 1
wt -t tabbed >/dev/null 2>&1
assert_eq "$(focused_tab)" "$tab"
assert_eq "$(tab_count)" 2

# A resurrected session restores the tab under a new ID; wt takes it over.
renumber_tab "$tab" 99
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

# wtrm closes the tab wt opened for the worktree.
wtrm -f prompted >/dev/null 2>&1
[[ -z $(tab_in "$project/prompted") ]] || fail "wtrm should close the worktree's tab"

# After a restart the recorded ID can belong to another tab, here one with a
# shell inside the worktree. wtrm must close the worktree's own tab instead.
tab=$(tab_in "$project/tabbed")
renumber_tab "$tab" 77
printf '%s\tnotes\n' "$tab" >> "$ZJ_STATE/tabs"
printf '50\t%s\tmain\t%s\t-\n' "$tab" "$project/tabbed/src" >> "$ZJ_STATE/panes"
wtrm tabbed >/dev/null 2>&1
grep -q "^$tab	notes" "$ZJ_STATE/tabs" || fail "wtrm should not close a tab that reused the recorded ID"
if grep -q "^77	" "$ZJ_STATE/tabs"; then fail "wtrm should close the worktree's renumbered tab"; fi

# wtrm leaves the tab you run it from open.
wt -b mine >/dev/null 2>&1
tab=$(tab_in "$project/mine")
(
  export ZELLIJ_PANE_ID=$(awk -F'\t' -v t="$tab" '$2 == t && $3 == "main" { print $1 }' "$ZJ_STATE/panes")
  wtrm mine >/dev/null 2>&1
)
grep -q "^$tab	" "$ZJ_STATE/tabs" || fail "wtrm should leave the caller's own tab open"

# A tab wt did not open is never closed, even one named after the worktree.
wt -s manual >/dev/null 2>&1
zellij action new-tab --name manual --cwd "$project/manual" >/dev/null
tab=$(tab_in "$project/manual")
wtrm manual >/dev/null 2>&1
grep -q "^$tab	" "$ZJ_STATE/tabs" || fail "wtrm should not close a tab wt did not open"

# Outside Zellij, -p fails before creating anything and -t changes directory.
unset ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID
if wt -p 'x' outside >/dev/null 2>&1; then fail "wt -p outside Zellij should fail"; fi
[[ ! -d $project/outside ]] || fail "wt -p outside Zellij should not create a worktree"
wt -t outside >/dev/null 2>&1
assert_eq "$PWD" "$project/outside"

print "worktree review tests: ok"
