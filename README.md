# dotfiles

Personal terminal setup for macOS (**iTerm2**), Debian, and Manjaro/Arch Linux
(**Ghostty**): **Helix + Yazi + Zellij** (Catppuccin Mocha), plus zsh helper
functions (git-worktree workflow, opencode reload, and more).

## Install

```sh
git clone <this-repo> ~/dotfiles
~/dotfiles/install.sh
exec zsh
```

`install.sh` (safe to rerun) selects Homebrew on macOS, APT on Debian, or
Pacman on Arch-based Linux,
installs the platform packages plus developer tools/language servers and the Yazi
flavor, symlinks `config/` into `~/.config` via GNU Stow, and appends a small
configuration block to `~/.zshrc` (adds the managed user-tool directories to `PATH`, sets
`EDITOR` to the available Helix executable, sources
`~/.config/zsh/secrets.zsh`, and loads the `shell/*.zsh` functions). A separate
managed preamble is kept at the beginning for Zellij autostart. If the account's
login shell is not zsh, the installer changes it permanently with `chsh`;
`exec zsh` enters zsh immediately without waiting for the next login. Run the
installer as your normal user, not with `sudo`; it elevates package installation
itself when needed.

Homebrew must already be installed on macOS. The Linux backends support Debian
13 (Trixie) and Pacman-based distributions such as Manjaro and Arch Linux.
Because several tools are not in Debian 13, its backend installs Helix, Yazi,
Zellij, Taplo, and Marksman from their upstream GitHub releases. Ghostty uses
the community Debian package linked from
[Ghostty's official installation docs](https://ghostty.org/docs/install/binary#debian-and-ubuntu).

### Managed developer tools

The installer keeps user-level tools with the package manager for their
ecosystem:

| Manager | Installed by | Managed tools |
| --- | --- | --- |
| Homebrew/Pacman | platform backend | Node/npm, Ruff, Taplo, Marksman, ShellCheck, shfmt |
| APT | `install/apt.sh` | Node/npm, ShellCheck, shfmt |
| Upstream release assets | `install/apt.sh` | Helix, Yazi, Ghostty, Zellij, Taplo, Marksman on Debian |
| Official uv installer (`~/.local/bin`) | `install.sh` | uv |
| `uv tool` | `install.sh` | Pyright, plus Ruff on Debian |
| npm (`~/.local`) | `install.sh` | bash/yaml/json language servers |
| Official OpenCode installer (`~/.opencode/bin`) | `install.sh` | OpenCode |
| Official rustup installer (`~/.cargo`, `~/.rustup`) | `install.sh` | stable Rust toolchain and Cargo |
| Cargo (`~/.cargo/bin`) | `install.sh` | `jinja-lsp` |

Rerunning `install.sh` upgrades the user-level tools. Jinja projects can set
their own template and backend paths in `pyproject.toml` when the defaults are
not sufficient:

```toml
[tool.jinja-lsp]
templates = "./templates"
backend = ["./src"]
```

Zellij autostarts from a pre-Oh My Zsh preamble in both iTerm2 and Ghostty, so
the outer shell immediately becomes Zellij without initializing the framework
twice. Ghostty hides its own tab bar and disables its tab and split creation
shortcuts; use Zellij (`Alt-t` for a tab, `Alt-n` for a pane) for all
multiplexing. Set `ZELLIJ_AUTO_START=false` before launching zsh when a bare
shell is needed.

The top bar (zjstatus) is loaded by `dev.kdl` straight from its release URL, so
the first time you must grant its plugin permission once (the installer prints
this): inside a zellij session run
`zellij plugin -f -- "<zjstatus-url>"`, press `y`, then close that pane.

## Layout

- `config/.config/{ghostty,zellij,helix,yazi,opencode}/` — stowed into `~/.config`
- `shell/*.zsh` — sourced directly by the `.zshrc` block
- `install/{apt,brew,pacman}.sh` — platform package installation backends
- `Brewfile` — Homebrew package manifest
- `secrets.zsh.example` — template; real secrets live in
  `~/.config/zsh/secrets.zsh` (gitignored, never committed)

### OpenCode BTW

The OpenCode TUI plugin provides `/btw`, which opens a dialog for a side
question. It sends a bounded text-only snapshot of the current conversation to
a temporary read-only session and displays a scrollable side-conversation above
a follow-up input. The temporary session persists for follow-up questions until
the modal closes, then it is deleted. The active session is never prompted or
modified.

## Changing the theme

Everything is **Catppuccin Mocha**, applied per tool. Because `config/` is
stowed (symlinked), editing these files changes the live config directly — no
reinstall needed, aside from the "apply" step noted below. Changes are of two
kinds: **(A)** rename a named theme, **(B)** recolor a handcrafted palette. (The
base 16 terminal colors come from your terminal app, not this repo.)

Switching to another **Catppuccin flavour** (Frappé/Macchiato/Latte) = do the
(A) renames + find/replace the Mocha hex with the target flavour's hex
(palettes at <https://catppuccin.com/palette>). A non-Catppuccin theme = (A)
renames + recolour the (B) files by hand.

### A. Named themes (rename, then apply)

| Tool | File | Setting | Apply |
| --- | --- | --- | --- |
| Helix | `config/.config/helix/config.toml` | `theme = "catppuccin_mocha_dim"` | `:config-reload` (or `:theme <name>` to preview) |
| Zellij | `config/.config/zellij/config.kdl` | `theme "catppuccin-mocha"` (built-in) | start a new zellij session |
| Yazi | `config/.config/yazi/package.toml` **and** `config/.config/yazi/theme.toml` | flavour name in **both** | `ya pkg install`, restart yazi |
| delta (git diff syntax) | `config/.config/git/config` | `syntax-theme = Catppuccin Mocha` | next `git diff` |

Helix's `catppuccin_mocha_dim` is a **local** theme (see B) that only inherits
the stock `catppuccin_mocha`. Point `theme` at any bundled name (e.g.
`catppuccin_macchiato`, `dracula`) to switch outright — the local file is then
just unused.

### B. Handcrafted palettes (edit the colours)

| What | File | Notes |
| --- | --- | --- |
| Helix docstring dim | `config/.config/helix/themes/catppuccin_mocha_dim.toml` | change `inherits` + the single `#5f7c65` green (blend recipe is in the file's comments); or delete the file and drop `_dim` in `config.toml` |
| delta UI (diff gutters, blame) | `config/.config/git/config` → `[delta "catppuccin-mocha"]` block | hardcoded hex: `blame-palette`, the `*-style` lines, `map-styles` |
| glow (the `cheat` pager) | `config/.config/glow/catppuccin-mocha.json` | full markdown palette. **Also referenced by** `shell/cheatsheet.zsh` and `config/.config/zellij/config.kdl` (the cheatsheet pane) — edit in place, or rename the file and update both refs |
| `cheat --pretty` HTML | `CHEATSHEET.css` | Catppuccin CSS vars at the top (`--base`, `--text`, `--red`, …) |
| zjstatus top bar | `config/.config/zellij/layouts/dev.kdl` | hex inside the `format_*` / `mode_*` / `tab_*` strings; independent of Zellij's `theme` |
| Zellij `onedark-custom` | `config/.config/zellij/config.kdl`, `themes {}` block | an **unused** custom theme (RGB triplets) — only matters if you set `theme` to it |

Not themed here (they follow the terminal palette): `fzf`
(`config/.config/fzf/*`), and plain `yazi.toml` / `init.lua`.

Cosmetic name-only mentions (don't affect colours, but update if you rename so
docs don't drift): the `README.md` intro, the Yazi-flavour echo in `install.sh`,
and the `catppuccin*` comments in `config/.config/git/config`, `CHEATSHEET.css`,
and `shell/cheatsheet.zsh`.

### Catppuccin Mocha hex (for find/replace)

`base #1e1e2e` · `mantle #181825` · `crust #11111b` · `surface0 #313244` ·
`surface1 #45475a` · `surface2 #585b70` · `overlay0 #6c7086` · `text #cdd6f4` ·
`subtext0 #a6adc8` · `subtext1 #bac2de` · `red #f38ba8` · `maroon #eba0ac` ·
`peach #fab387` · `yellow #f9e2af` · `green #a6e3a1` · `teal #94e2d5` ·
`sky #89dceb` · `sapphire #74c7ec` · `blue #89b4fa` · `lavender #b4befe` ·
`mauve #cba6f7` · `pink #f5c2e7`

## Notes

- The `shell/*.zsh` files are plain zsh functions (not oh-my-zsh plugins);
  completions register via `compdef` if `compinit` has run.
- Zellij: `Alt-y` summons a Yazi picker that opens files into a named `editor`
  (Helix) pane; `dev.kdl` uses a swap layout (editor top / terminal bottom /
  opencode right).
