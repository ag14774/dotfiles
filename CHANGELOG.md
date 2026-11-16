# Changelog

What changed, and what to do after pulling. The code and the README describe
only how things are now; this file is where the changes live. Newest first.

## 2026-11-16 (`cbf95bd`)

A review: clearer packages, fewer leftovers, the same daily flow.

**After pulling, in this order:**

1. Link the packages before OpenCode reloads its plugins (without
   `node_modules/ade-kit` they can't load). In the checkout:
   `npm install --omit=dev --omit=optional --omit=peer` (it downloads
   nothing), or rerun `install.sh`, which does it and restows the links.
2. `opencode service restart` (interrupts running conversations), then
   `zellij-sync-bars --restart` inside Zellij for new OpenCode panes, and
   `exec zsh` in open shells.

**What changes for you:**

- OpenCode 2 is required: the OpenCode V1 migration is gone. The installer
  still creates `cli.json` and adds `-opencode.notifications`.
- Seed settings are renamed: `WT_SEED` → `ADE_SEED`, `WT_SEED_FILE` →
  `ADE_SEED_FILE`, and a repository's `<common-dir>/wt-seed` →
  `<common-dir>/ade-seed`. The old names are ignored; rename yours.
- Messages and help say `ade worktree …` instead of `wt`, `wtrm` and the
  like. The `wt*` functions work as before; `wthelp` shows the help.
- `ade workspace`, `ade tabs` and `ade close-tabs` are removed.
- `ocreload` runs `ade restart-agent`, and the Alt-y picker uses
  `ade where`, so both follow the pane names in the ADE config.
- `zellij.newPanes` in the ADE config: where a new pane of a role opens. A
  new agent pane opens on the right by default.
- `ade review` (Alt-v) and the `status` tool count changes from
  `worktrees.base` (default `origin/HEAD`), the same base new branches
  start from.
- Your own adapters get `kit.git`, `kit.fail` and
  `kit.builtin.multiplexer`, so a custom layout or a wrapped multiplexer
  needs no fork. Plugins import `"ade-kit"`.
- New: an MIT licence, a README per package, `npm test`, `npm run check` and
  `npm run format`.
