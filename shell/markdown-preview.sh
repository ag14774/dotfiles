#!/usr/bin/env bash
# Browser preview shared by mdview, cheat --pretty, and Helix's + m.
set -euo pipefail

if (($# > 1)); then
  printf 'Usage: mdview [markdown-file]\n' >&2
  exit 1
fi

md="${1:-}"
if [[ -z "$md" ]]; then
  for candidate in README.md readme.md README.MD README.markdown readme.markdown; do
    if [[ -f "$candidate" ]]; then
      md="$candidate"
      break
    fi
  done
fi
if [[ -z "$md" || ! -f "$md" ]]; then
  printf 'mdview: Markdown file not found: %s\n' "${md:-README.md (pass a path explicitly)}" >&2
  exit 1
fi
if ! command -v pandoc >/dev/null 2>&1; then
  printf 'mdview needs pandoc; rerun ~/dotfiles/install.sh\n' >&2
  exit 1
fi
if command -v xdg-open >/dev/null 2>&1; then
  opener=xdg-open
elif command -v open >/dev/null 2>&1; then
  opener=open
else
  printf 'mdview needs xdg-open or open\n' >&2
  exit 1
fi

# Resolve paths before changing directory, so images are relative to the document
# rather than the shell/editor workspace. Each preview has its own HTML snapshot.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
md_dir="$(cd -- "$(dirname -- "$md")" && pwd)"
md_name="$(basename -- "$md")"
out_dir="$(mktemp -d "${TMPDIR:-/tmp}/mdview.XXXXXX")"
cd -- "$md_dir"
pandoc "./$md_name" --from=gfm --standalone --embed-resources \
  --css "$script_dir/../CHEATSHEET.css" \
  --metadata title="$md_name" -o "$out_dir/index.html"
"$opener" "$out_dir/index.html"
