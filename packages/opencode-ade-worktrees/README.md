# opencode-ade-worktrees

An OpenCode plugin (server part only): OpenCode's worktree strategy on
[ade-kit](../ade-kit)'s worktree commands. What OpenCode makes or removes
itself (in the TUI, Ctrl+P "Open" → a project → Right → Ctrl+N "New
worktree"; the desktop app; the agents' `worktree_remove`; its API) then
follows the repository's layout, gets a real branch named as you typed it,
seeded files, and `ade worktree rm`'s checks (with changes, OpenCode asks
before forcing). It opens and closes no tabs. A removed worktree's location
is evicted from the service, as `ade worktree rm` does: OpenCode keeps it,
and its reload then fails. Agents make worktrees with
[opencode-ade](../opencode-ade)'s `delegate`, which also opens a tab.

It registers under the name of OpenCode's own Git strategy, `git`, so the
worktrees OpenCode already knows go through it too.

It needs OpenCode 2.2.5 or newer and ade-kit beside it (the repository's npm
workspaces).

## Installing

Link the package folder as `~/.config/opencode/plugins/ade-worktrees`. A
change applies after `opencode service restart`.

## Tests

`node --test test/*.test.ts`. The dotfiles' `tests/opencode_worktrees_smoke.zsh`
runs it with a private OpenCode service (no Zellij, no model calls).
