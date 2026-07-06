# dotfiles

Personal macOS terminal setup: **Helix + Yazi + Zellij** (Catppuccin Mocha),
plus a couple of zsh helper functions (git-worktree workflow, opencode reload).

## Install

```sh
git clone <this-repo> ~/dotfiles
~/dotfiles/install.sh
exec zsh
```

`install.sh` (idempotent) installs `Brewfile` packages + Python/JS language
servers, fetches the zjstatus plugin and the Yazi flavor, symlinks `config/`
into `~/.config` via GNU Stow, and appends a small managed block to `~/.zshrc`
(sets `EDITOR=hx`, sources `~/.config/zsh/secrets.zsh`, and loads the
`shell/*.zsh` functions).

## Layout

- `config/.config/{zellij,helix,yazi}/` — stowed into `~/.config`
- `shell/{worktree,ocreload}.zsh` — sourced directly by the `.zshrc` block
- `Brewfile` — Homebrew dependencies
- `secrets.zsh.example` — template; real secrets live in
  `~/.config/zsh/secrets.zsh` (gitignored, never committed)

## Notes

- The two `shell/*.zsh` files are plain zsh functions (not oh-my-zsh plugins);
  completions register via `compdef` if `compinit` has run.
- Zellij: `Alt-y` summons a Yazi picker that opens files into a named `editor`
  (Helix) pane; `dev.kdl` uses a swap layout (editor top / terminal bottom /
  opencode right).
