#!/usr/bin/env zsh
# gcai drafts with the model a new OpenCode conversation would start with
# (`opencode run` alone falls back to a rate-limited free model), deletes its
# drafting session, and reports OpenCode's error when no message comes back.

set -eu

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
trap 'rm -rf "$TMP"' EXIT

fail() {
  print -u2 "FAIL: $*"
  exit 1
}

mkdir -p "$TMP/bin" "$TMP/state/opencode" "$TMP/repo"
cat > "$TMP/bin/opencode" <<'EOF'
#!/usr/bin/env zsh
if [[ $1 == api && $2 == get && $3 == /api/config* ]]; then
  print -r -- "${FAKE_CONFIG:-[]}"
elif [[ $1 == run ]]; then
  if [[ $4 == --model ]]; then print -r -- "$5"; else print -r -- -; fi > "$FAKE_LOG.model"
  cat > /dev/null
  print -r -- "$FAKE_EVENTS"
elif [[ $1 == session && $2 == delete ]]; then
  print -r -- "$3" > "$FAKE_LOG.deleted"
fi
EOF
chmod +x "$TMP/bin/opencode"
export PATH="$TMP/bin:$PATH" XDG_STATE_HOME="$TMP/state" FAKE_LOG="$TMP/log"
unset GCAI_MODEL FAKE_CONFIG
source "$ROOT/shell/git.zsh"

cd "$TMP/repo"
git init -q
git config user.email test@example.com
git config user.name test
git config commit.gpgsign false
git commit -q --allow-empty -m init

stage() { print -r -- "$RANDOM" > file; git add file; rm -f "$FAKE_LOG".*(N); }
export FAKE_EVENTS='{"type":"step_start","sessionID":"ses_1"}
{"type":"text","sessionID":"ses_1","part":{"text":"feat: add file"}}'

drafts_with() { # $1 = model gcai must pass ("-" for none)
  stage
  gcai -y >/dev/null 2>&1 || fail "gcai failed (expected model '$1')"
  [[ $(<"$FAKE_LOG.model") == "$1" ]] || fail "expected model '$1', got '$(<"$FAKE_LOG.model")'"
  [[ $(git log -1 --format=%s) == "feat: add file" ]] || fail "the drafted message was not committed"
  [[ $(<"$FAKE_LOG.deleted") == ses_1 ]] || fail "the drafting session was not deleted"
}

drafts_with -
print -r -- '{"recent":[{"providerID":"azure","modelID":"recent"},{"providerID":"x","modelID":"older"}]}' \
  > "$TMP/state/opencode/model.json"
drafts_with azure/recent
export FAKE_CONFIG='[{"type":"document","info":{"model":"global/model"}},{"type":"directory","info":{}},{"type":"document","info":{"model":"project/model"}}]'
drafts_with project/model
export FAKE_CONFIG='[{"type":"document","info":{"model":{"providerID":"obj","model":"m","variant":"high"}}}]'
drafts_with obj/m#high
GCAI_MODEL=chosen/model drafts_with chosen/model

stage
before=$(git rev-parse HEAD)
FAKE_EVENTS='{"type":"error","sessionID":"ses_1","error":{"message":"Free usage limit reached."}}' \
  gcai -y >/dev/null 2>"$TMP/err" && fail "gcai should fail without a message"
grep -q 'Free usage limit reached.' "$TMP/err" || fail "OpenCode's error was not shown: $(<"$TMP/err")"
[[ $(git rev-parse HEAD) == "$before" ]] || fail "gcai committed without a message"
[[ $(<"$FAKE_LOG.deleted") == ses_1 ]] || fail "the failed drafting session was not deleted"

print "gcai tests: ok"
