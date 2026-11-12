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
# tabs (id, name), panes (id, tab, title, cwd, command[, "exited"]) and the
# focused tab. An empty cwd is a pane for which Zellij reports no directory.
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
          pane_cwd: (if .[3] == "" then null else .[3] end), exited: (.[5] == "exited"),
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

# ls --json reports each worktree's branch, changes and tab, for the plugin.
wt -b listed >/dev/null 2>&1
print change > "$project/listed/notes.md"
json=$("$ROOT/config/.local/bin/wt-core" ls --json)
entry() { jq -c --arg p "$project/$1" '.[] | select(.path == $p) | {branch, changed, ahead, behind, tab}' <<< "$json"; }
assert_eq "$(entry listed)" '{"branch":"listed","changed":1,"ahead":0,"behind":0,"tab":"sure"}'
assert_eq "$(entry main)" '{"branch":"main","changed":0,"ahead":0,"behind":0,"tab":null}'
# Without the caller's pane the tabs are found all the same; outside Zellij
# there are none. A live pane that reports no directory makes a tab "unsure".
json=$(env -u ZELLIJ_PANE_ID "$ROOT/config/.local/bin/wt-core" ls --json)
assert_eq "$(entry listed | jq -r .tab)" sure
json=$(env -u ZELLIJ "$ROOT/config/.local/bin/wt-core" ls --json)
assert_eq "$(entry listed | jq -r .tab)" null
listed_tab=$(tab_in "$project/listed")
printf '62\t%s\tstarting\t\t-\n' "$listed_tab" >> "$ZJ_STATE/panes"
json=$("$ROOT/config/.local/bin/wt-core" ls --json)
assert_eq "$(entry listed | jq -r .tab)" unsure
assert_eq "$(entry main | jq -r .tab)" null
wtrm -f listed >/dev/null 2>&1
zellij action close-tab-by-id "$listed_tab"

# Outside Zellij, -p fails before creating anything and -t changes directory.
unset ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID
if wt -p 'x' outside >/dev/null 2>&1; then fail "wt -p outside Zellij should fail"; fi
[[ ! -d $project/outside ]] || fail "wt -p outside Zellij should not create a worktree"
wt -t outside >/dev/null 2>&1
assert_eq "$PWD" "$project/outside"

print "worktree review tests: ok"
