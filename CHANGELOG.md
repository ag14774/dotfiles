# Changelog

What changed, and what to do after pulling. The code and the README describe
only how things are now; this file is where the changes live. Newest first.

## 2026-11-16: ade in its own repository

The `ade` command and the OpenCode plugins now come from
[ag14774/ade](https://github.com/ag14774/ade). They work as before; the
`wt*` functions and `ocreload` stay here and run `ade` from `PATH`.

**After pulling, in this order** (until `install.sh` has run, `ade` and the
OpenCode plugins point at files that are gone):

1. To work on ade, set `export ADE_HOME=<your ade checkout>` in
   `~/.config/zsh/local.zsh` first, and `exec zsh`. Otherwise the installer
   keeps its own clone in `~/.local/share/ade`.
2. Rerun `install.sh`. It clones ade (or checks your `ADE_HOME`), and links
   `ade` and the plugins from there (ade's `install.sh`).
3. `opencode service restart`, then `zellij-sync-bars --restart` inside
   Zellij, and `exec zsh` in open shells.
4. `rm -rf node_modules` in the checkout: nothing uses it any more.

**What changes for you:**

- `packages/`, `npm run check` and the package tests are gone from this
  repository; `npm test` runs the dotfiles' own tests.
- `install.sh` pins ade at `ADE_REF`; bump it to take a newer ade.
- `tests/keys_smoke.zsh` and `tests/zellij_restore_smoke.zsh` use ade's
  sandbox (and `keys_smoke` is ade's test, run on this config).

## 2026-11-16 (#2)

`ocreload` no longer fails after a worktree is removed.

**After pulling:** `opencode service restart` (interrupts running
conversations), for the worktrees OpenCode removes itself.

**What changes for you:**

- OpenCode's service keeps a location for every folder it served, and its
  reload failed ("Directory not found") once one of those folders was gone,
  so `ocreload` stopped before restarting the agent. Now `ade worktree rm`,
  `prune` and OpenCode's own worktree removals have the service let go of
  the removed worktree, and `ocreload` first has it let go of any folder
  that is gone (a worktree deleted by hand, say).
- New: `ade forget-gone` does that on its own and prints the folders. Agent
  adapters of your own can have a `forgetGone`.

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
