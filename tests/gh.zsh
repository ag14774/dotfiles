#!/usr/bin/env zsh
# The gh wrapper (config/.local/bin/gh) runs gh as the account in the
# repository's git config (gh.user), and doesn't run when that account isn't
# logged in, rather than run as another one.

set -eu

ROOT=${0:A:h:h}
TMP=$(mktemp -d)
TMP=${TMP:A}
trap 'rm -rf "$TMP"' EXIT

fail() {
  print -u2 "FAIL: $*"
  exit 1
}

# Stand-in for the real gh, after the wrapper on PATH: `auth token --user NAME`
# knows "work" and "personal"; other commands print the token they run with.
mkdir -p "$TMP/wrapper" "$TMP/real" "$TMP/home" "$TMP/plain" "$TMP/repo"
ln -s "$ROOT/config/.local/bin/gh" "$TMP/wrapper/gh"
cat > "$TMP/real/gh" <<'EOF'
#!/usr/bin/env zsh
if [[ $1 == auth && $2 == token ]]; then
  [[ $4 == (work|personal) ]] || exit 1
  print -r -- "token-$4"
else
  print -r -- "${GH_TOKEN:-active} $*"
fi
EOF
chmod +x "$TMP/real/gh"
# No global git config: the user's ~/.gitconfig may set gh.user.
export PATH="$TMP/wrapper:$TMP/real:$PATH" HOME="$TMP/home" XDG_CONFIG_HOME="$TMP/home/.config" GIT_CONFIG_NOSYSTEM=1
unset GH_TOKEN GITHUB_TOKEN GH_ACCOUNT

cd "$TMP/plain"
git init -q
[[ $(gh pr list) == "active pr list" ]] || fail "without gh.user, gh should run as the active account"

cd "$TMP/repo"
git init -q
git config gh.user personal
[[ $(gh pr list) == "token-personal pr list" ]] || fail "gh should run as gh.user"
[[ $(GH_ACCOUNT=work gh pr list) == "token-work pr list" ]] || fail "GH_ACCOUNT should pick the account"
[[ $(GH_TOKEN=mine gh pr list) == "mine pr list" ]] || fail "a GH_TOKEN already set should win"
[[ $(gh auth status) == "active auth status" ]] || fail "gh auth should run as is"

git config gh.user nobody
out=$(gh pr list 2>&1) && fail "gh ran without nobody's token: $out"
[[ $out == "gh: nobody is not logged in (gh auth login), so gh did not run" ]] || fail "unexpected message: $out"

print "gh tests: ok"
