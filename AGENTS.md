# AGENTS.md

For coding agents changing these dotfiles. What they are, setting up a
machine, and what is never committed: [README.md](README.md).

## Where things are

- The live checkout is `~/dotfiles/main`, a worktree of `~/dotfiles/.bare`:
  stow's links in `~/.config`, `~/.local/bin` and `~/.editorconfig` point
  into it, and `~/.zshrc` sources `shell/*.zsh` from it. Other worktrees,
  such as the one you may be in, are not live.
- `config/` is stowed into `$HOME`; `shell/*.zsh` is the zsh setup;
  `install.sh`, `install/` and `Brewfile` are the installer; `tests/` has the
  tests.
- ade is in `$ADE_HOME` (this machine: `~/projects/ade/main`), else in
  `~/.local/share/ade`.

## Where changes belong

- The `ade` command, the OpenCode plugins, and anything someone using ade
  without these dotfiles would want: in
  [ade](https://github.com/ag14774/ade), with its own AGENTS.md. These
  dotfiles use only its public parts: the `ade` command, its config file
  (`config/.config/ade/config.json`), its `install.sh`, and its live tests'
  `SANDBOX_*` settings. Never run or source any other file of an ade
  checkout.
- Everything personal (keys, theme, tools, shell): here.

## Rules

- Never run `install.sh` from a checkout other than the live one: it would
  point the links and `~/.zshrc` at yours. Check installer changes with
  `bash -n`, shellcheck and reading; run them only on a throwaway machine.
- Never edit `~/.zshrc` outside the two blocks `install.sh` keeps; change
  `install.sh` instead.
- Never commit secrets or machine-local files (README, "Files").
- `install.sh` stays safe to rerun, runs as the user, and treats macOS
  (Homebrew), Debian (APT) and Arch (Pacman) alike: a tool added to one goes
  in all three.
- A pinned version is bumped together with its SHA-256 (README, "Keeping it
  up to date").
- A key or command that changes changes in CHEATSHEET.md too, and in the
  README's table if it is there.
- Never run `zellij` against the user's session `main`, or
  `opencode service …`. Run what may ask Zellij (`ade where`,
  `ade worktree ls --json`) with
  `env -u ZELLIJ -u ZELLIJ_SESSION_NAME -u ZELLIJ_PANE_ID`.

## Conventions

- Comments are sparse and say what the code does and why, never its history;
  history goes in commit messages. Small commits, each one working.
- Bash for scripts (`set -euo pipefail`), zsh for `shell/`; shellcheck
  clean, and formatted with
  `shfmt -w -i 2 -ci install.sh install/*.sh shell/*.sh config/.config/zellij/*.sh config/.config/helix/*.sh config/.local/bin/gh`.
- `.editorconfig` for the rest.

## Tests

`zsh tests/run.zsh` runs the tests of the functions and scripts here, with
stand-ins for Zellij, OpenCode and ade. A change to one of them comes with
its test.

After changing the keys and their scripts, `dev.kdl` or the restore hook, or
upgrading Zellij, Helix, Yazi or tuicr, run ade's live tests on this config,
in ade's checkout:

```sh
export SANDBOX_CONFIG=<this checkout>/config/.config SANDBOX_BIN=<this checkout>/config/.local/bin
zsh tests/keys_smoke.zsh
zsh tests/zellij_restore_smoke.zsh
```

They take a few minutes each, in a sandbox of their own (Zellij server, HOME,
OpenCode service); ade's AGENTS.md has their safety rules.
