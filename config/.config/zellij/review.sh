#!/usr/bin/env bash
# ~/.config/zellij/review.sh -- what Alt-v runs, in a floating pane named
# "review": now `ade review` (packages/ade-kit), a tuicr review of this tab's
# worktree whose comments go to this tab's OpenCode. Kept for the key until it
# calls ade; it finds ade through its link into this checkout, so it works
# before ade is stowed.
#
#   review.sh           what Alt-v runs
#   review.sh --scope   what a review here covers
exec "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../.local/bin/ade" review "$@"
