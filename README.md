# dotfiles

My terminal-only development setup for macOS (iTerm2) and Linux (Debian 13
amd64, Arch and Manjaro; Ghostty): Zellij, Helix, OpenCode, Yazi and tuicr on
zsh, tied together by [ade](https://github.com/ag14774/ade). Each git worktree
gets a Zellij tab with a shell, OpenCode and, once you open a file, Helix.
Catppuccin Mocha throughout.

What ade does (worktree tabs, `wt`, `Alt-y`, `Alt-v`, Helix `+ a`, delegating,
the agent statuses in the bar, tabs that come back after a restart) is in
[ade's starter README](https://github.com/ag14774/ade/blob/main/starter/README.md);
this repository is my configuration on top. Every key: [CHEATSHEET.md](CHEATSHEET.md)
(`cheat`, `Alt-/`).

## A new machine

**Before:** on macOS, [Homebrew](https://brew.sh) and git; on Linux, git,
curl and sudo. Then:

```sh
git clone https://github.com/ag14774/dotfiles ~/dotfiles
~/dotfiles/install.sh
exec zsh
```

Run it as yourself; it uses `sudo` where it must, and `chsh` asks for your
password once. It is safe to rerun, and a rerun upgrades what it installed.
It:

- installs the packages: `Brewfile` (macOS), `install/apt.sh` (Debian;
  tools Debian lacks come from upstream, pinned with their SHA-256),
  `install/pacman.sh` (Arch; a full `pacman -Syu`);
- installs into your home: language servers (npm in `~/.local`, `uv tool`,
  `cargo install`), the Rust toolchain (`rustup`), OpenCode 2
  (`~/.opencode/bin`; `OPENCODE_VERSION=2.x.y` picks one) and its
  `cli.json`;
- links `config/` into `~/.config`, `~/.local/bin` and `~/.editorconfig` with
  GNU Stow (it stops on a file already there: move that away and rerun);
- clones ade into `~/.local/share/ade`, at the latest commit of its `main`
  (`ADE_REF` picks another), and runs its `install.sh`, which links `ade` and
  the OpenCode plugins;
- makes zsh the login shell, and keeps two blocks in `~/.zshrc` (the first
  run's `~/.zshrc` stays in `~/.zshrc.dotfiles-bak`): the top one loads
  `secrets.zsh` and `local.zsh` and starts Zellij, the bottom one loads
  `shell/*.zsh`.

**Then, by hand:**

1. The terminal. iTerm2: Settings → Profiles → Text, font "JetBrainsMono
   Nerd Font" (the Brewfile installs it); Keys → General, Left Option key:
   Esc+ (the `Alt-` keys); Colors → Color Presets, import Catppuccin Mocha
   from <https://github.com/catppuccin/iterm>. Ghostty: `font-family =
   JetBrainsMono Nerd Font` and `theme = Catppuccin Mocha` in its config; on
   Debian, the font from <https://www.nerdfonts.com> into
   `~/.local/share/fonts`, then `fc-cache`.
2. Secrets, in `~/.config/zsh/secrets.zsh` (made from `secrets.zsh.example`):
   API keys, `GCAI_MODEL`, and for Vertex AI `GOOGLE_CLOUD_PROJECT` (with
   `gcloud auth application-default login`).
3. OpenCode: `opencode auth login` for your providers, and
   `~/.config/opencode/opencode.jsonc` (model, providers, MCP servers) and
   `skills/`, which are not in this repository.
4. Git: your identity in `~/.gitconfig`, your SSH keys and `~/.ssh/config`
   (this repository's remote uses the host alias `github_personal`), and
   `gh auth login` for each GitHub account, chosen per repository by
   `gh.user` (`config/.local/bin/gh` says how).
5. Open a terminal. On Zellij's welcome screen, press `Esc` (`Enter`
   installs Zellij.app). The top bar needs a permission once per release:
   run the `zellij plugin -f -- "<url>"` command the installer printed,
   press `y`, and close that pane.
6. To work on ade: `wtclone https://github.com/ag14774/ade ~/projects/ade`,
   then `cd ~/projects/ade && wt main`; put
   `export ADE_HOME=$HOME/projects/ade/main` in `~/.config/zsh/local.zsh`,
   `exec zsh`, and rerun `install.sh`: that checkout is then the live one,
   linked and never changed by the installer.

**Check it works:** a terminal opens the Zellij session `main`; `ade where`
prints your folder; in a clone, `wt -t try` opens a tab with OpenCode, and
`wtrm try` removes it; `Alt-y` opens a file in Helix, `Alt-v` a review; the
bar shows the agents' statuses; `zsh tests/run.zsh` passes.

## Mine, on top of ade

|                                         |                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| one session, `main`                     | every terminal attaches to it (`ZELLIJ_AUTO_START=false`: a plain shell); Ghostty's tabs are off   |
| `ocreload`                              | `ade restart-agent --reload`: the tab's OpenCode, restarted after its service reloads              |
| `zreset`                                | end the session and delete its saved copy; the next terminal starts afresh                         |
| `zellij-sync-bars [--restart]`          | give saved sessions the bar from `dev.kdl`, after a new bar release or a Zellij upgrade            |
| `gcai`, `ggpush`, `ggpull`              | a commit message drafted by OpenCode from the staged diff; push or pull the branch's upstream      |
| `mdview [FILE]`, Helix `+ m`, `cheat`   | Markdown in the browser; the cheatsheet in a pager (`Alt-/`: floating)                             |
| Helix `+ g`, `+ r`, `g u`, `Ctrl-↑↓`    | the git hunk under the cursor; run the buffer; go to the parent class's method; move lines        |
| `/btw`                                  | a side question in OpenCode, outside the conversation                                              |
| `gh`                                    | the GitHub CLI as the account a repository names in `gh.user`                                      |

Helix doesn't reload files agents change: `Ctrl-r` reloads them all,
dropping unsaved edits.

## Files

- `config/`, stowed into `$HOME`: `zellij/` (keys, session `main`, the tab
  layout and top bar, the picker, the restore hook), `helix/`, `yazi/`,
  `tuicr/`, `git/`, `ghostty/`, `fzf/`, `glow/`, `starship.toml`,
  `opencode/` (`cli.json.example`, `/btw`), `ade/config.json` (tab names),
  `.editorconfig` (for every repository under `$HOME`), and in
  `.local/bin/` `gh` and `zellij-sync-bars`.
- `shell/*.zsh`: the zsh setup, `wt*` (short names for `ade worktree`, with
  completions), `ocreload`, `zreset`, `gcai`, `mdview` and `cheat`.
- `install.sh`, `install/`, `Brewfile`: the installer.
- `tests/`: the tests of the functions and scripts here.

Never in this repository: `~/.config/zsh/secrets.zsh`,
`~/.config/zsh/local.zsh` (machine-local exports and functions; it runs
before Zellij starts, and before compinit), `~/.gitconfig`, `~/.ssh/`,
OpenCode's `opencode.jsonc`, auth and conversations.

## Keeping it up to date

Pull, then rerun `install.sh`: it relinks `config/` and moves ade to its
latest commit, and says if ade moved: ade's
[CHANGELOG](https://github.com/ag14774/ade/blob/main/CHANGELOG.md) says what
else that needs (often `opencode service restart`, which interrupts running
conversations, then `ocreload` in each tab).

Pinned on purpose, bumped by hand: the Debian downloads (versions and
SHA-256s at the top of `install/apt.sh`), the top bar's release URL in
`config/.config/zellij/layouts/dev.kdl` (then `zellij-sync-bars --restart`
inside Zellij), Yazi's packages in `config/.config/yazi/package.toml`, and
Helix's Python query in `config/.config/helix/runtime/` (copied from Helix:
copy it again after upgrading Helix).

## Changing the theme

Everything is Catppuccin Mocha, set per tool; `config/` is stowed, so edits
apply to the live config. The 16 base terminal colours come from the terminal
app. For another flavour, rename the themes below and replace the Mocha hex
values with the flavour's (<https://catppuccin.com/palette>).

| Tool   | File                                                | Setting                           | Apply                          |
| ------ | --------------------------------------------------- | --------------------------------- | ------------------------------ |
| Helix  | `config/.config/helix/config.toml`                  | `theme = "catppuccin_mocha_dim"`  | `:config-reload`               |
| Zellij | `config/.config/zellij/config.kdl`                  | `theme "catppuccin-mocha"`        | a new session                  |
| Yazi   | `config/.config/yazi/package.toml` and `theme.toml` | the flavour, in both              | `ya pkg install`, restart Yazi |
| delta  | `config/.config/git/config`                         | `syntax-theme = Catppuccin Mocha` | next `git diff`                |
| tuicr  | `config/.config/tuicr/config.toml`                  | `theme = "catppuccin-mocha"`      | next review                    |

Hand-picked colours: Helix's dimmed docstrings
(`config/.config/helix/themes/catppuccin_mocha_dim.toml`), delta's gutters
and blame (`config/.config/git/config`), glow
(`config/.config/glow/catppuccin-mocha.json`), `mdview` and `cheat --pretty`
(`CHEATSHEET.css`), and the top bar (the colours in `dev.kdl`'s bar options).

## Licence

MIT, except `config/.config/helix/runtime/queries/python/highlights.scm`
(Helix's, MPL 2.0) and `config/.config/opencode/tui-plugins/btw-v2`
(adapted from OpenCode, MIT; its `LICENSE`).
