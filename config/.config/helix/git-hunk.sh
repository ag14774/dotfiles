#!/usr/bin/env bash
# git-hunk.sh -- peek the git-diff hunk under Helix's cursor.
#
# Helix binds `+g` to `git-hunk.sh <file> <cursor_line>` (see config.toml). It
# opens a floating zellij pane showing ONLY the diff hunk (working tree vs HEAD)
# that contains that line, coloured by delta -- handy for eyeballing what
# opencode changed in the block you're on, without running a full `git diff`.
# It re-invokes itself with --view inside the floating pane.
set -euo pipefail

view() {
  local file=$1 line=$2 hunk
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "git-hunk: not inside a git repository."
  else
    # Keep only the file header + the single hunk whose NEW-file range covers the
    # cursor line (parsed from each `@@ -old +new @@` header).
    hunk=$(git diff HEAD -- "$file" 2>/dev/null | awk -v L="$line" '
      /^diff --git/ { inhdr = 1 }
      /^@@/ {
        inhdr = 0
        plus = $3; gsub(/\+/, "", plus); split(plus, a, ",")
        n = a[1] + 0; c = (a[2] == "" ? 1 : a[2] + 0)
        show = (L >= n && L <= n + c - 1)
        if (show) print
        next
      }
      inhdr { print; next }
      show
    ')
    if printf '%s\n' "$hunk" | grep -q '^@@'; then
      printf '%s\n' "$hunk" | delta --paging=always
      return 0
    fi
    printf 'git-hunk: no uncommitted change on line %s of %s.\n' "$line" "$file"
  fi
  printf '\n(press Enter to close)'
  read -r _ || true
}

if [ "${1:-}" = "--view" ]; then
  view "$2" "$3"
  exit 0
fi

# Launcher (called from Helix): open the view in a floating zellij pane.
file=${1:?usage: git-hunk.sh <file> <line>}
line=${2:?usage: git-hunk.sh <file> <line>}
zellij run --floating --close-on-exit --name "git-hunk" --cwd "$PWD" -- \
  bash "$0" --view "$file" "$line" >/dev/null 2>&1
