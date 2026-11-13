# dotfiles

A terminal-only agentic development environment (ADE) for macOS (iTerm2) and
Linux (Debian 13, Arch and Manjaro; Ghostty): **Zellij**, **Helix**,
**OpenCode**, **Yazi** and **tuicr**, glued together with zsh and the packages
in [`packages/`](packages). Each git worktree gets a Zellij tab with a shell,
OpenCode and, once you open a file, Helix. Agents can open files in your
editor, start work in a new worktree tab and report on the others, and the
top bar shows what every tab's agents are doing. Catppuccin Mocha throughout.

## Install

```sh
git clone https://github.com/ag14774/dotfiles ~/dotfiles
~/dotfiles/install.sh
exec zsh
```

`install.sh` picks Homebrew (macOS), APT (Debian) or Pacman (Arch-based
Linux) and installs the platform packages, the developer tools and language
servers below, and OpenCode 2 with its app settings (`cli.json`, created from
`config/.config/opencode/cli.json.example` when missing). It links `config/`
into `~/.config` and `~/.local/bin` with GNU Stow, links the packages for the
OpenCode plugins (`npm install`, which downloads nothing), makes zsh the login
shell, and keeps two blocks in `~/.zshrc`: one at the top starts Zellij, one
at the end loads `shell/*.zsh`. It is safe to rerun, and rerunning upgrades the
user-level tools. Run it as your normal user; it uses `sudo` itself where
needed.

- macOS needs Homebrew first.
- Debian 13 (amd64 only) gets Yazi, Zellij, tuicr, Taplo and Marksman from
  their upstream releases, Ghostty from the community package its docs link
  to, and Helix as a pinned `.deb`: bump `HELIX_VERSION`, `HELIX_DEB_VERSION`
  and `HELIX_SHA256` in `install/apt.sh` to upgrade it.
- `OPENCODE_VERSION=2.x.y ~/dotfiles/install.sh` picks an OpenCode release.
- The top bar needs a permission once per release: inside Zellij, run the
  `zellij plugin -f -- "<bar-url>"` command the installer prints, press `y`,
  and close that pane.

| Manager | Tools |
| --- | --- |
| Homebrew / Pacman | Node/npm, Ruff, Taplo, Marksman, ShellCheck, shfmt, GitHub CLI |
| APT (`install/apt.sh`) | Node/npm (NodeSource, current LTS), ShellCheck, shfmt, GitHub CLI |
| uv's installer (`~/.local/bin`) | uv |
| `uv tool` | Pyright, plus Ruff on Debian |
| npm (`~/.local`) | TypeScript, bash/yaml/json language servers |
| OpenCode's installer (`~/.opencode/bin`) | OpenCode 2 |
| rustup and Cargo (`~/.cargo`) | stable Rust, `jinja-lsp` |

## Using it

Every terminal attaches to one Zellij session, `main` (set
`ZELLIJ_AUTO_START=false` for a plain shell). Zellij does all the tabs and
panes (`Alt-t` a tab, `Alt-n` a pane); Ghostty's own are switched off. A tab
belongs to one worktree: a shell pane, OpenCode on the right, and Helix above
the shell once a file is opened.

| | |
| --- | --- |
| `wt <branch>` | cd into the branch's worktree, creating it; `-s` stays and prints its path, `-t` goes to its tab, `-b` opens the tab in the background |
| `wt -p "task" <branch>` | a background tab whose OpenCode starts on the task (`--session ID`: on an existing conversation) |
| `wtrm`, `wtprune [-m]`, `wtls`, `wtclone`, `wtconvert` | remove a worktree (and its tabs), remove those whose branch is gone or merged, list, clone or convert a repository for worktrees (`wthelp`) |
| `Alt-y` | Yazi as a picker; files open in the tab's Helix |
| Helix `+` `a` | ask the tab's OpenCode about the line or the selection |
| `Alt-v` | review everything the worktree changed, committed or not, in tuicr; `y` hands your comments to OpenCode, `e` opens a file in Helix |
| "delegate this", `/delegate` | OpenCode starts the work in a new worktree tab ("with the context" carries the conversation over) |
| "how are the other worktrees doing?" | OpenCode's `status` tool |
| `ocreload` | restart the tab's OpenCode in the current folder |
| `zreset` | delete `main`, saved copy included, for a clean start |
| `mdview [FILE]`, Helix `+` `m` | Markdown in the browser |
| `cheat`, `Alt-/` | the cheatsheet ([CHEATSHEET.md](CHEATSHEET.md): all the keys) |
| `/btw` | a side question in OpenCode, outside the conversation |
| `gcai` | a commit message drafted by OpenCode from the staged diff |

Each tab's name starts with the most urgent status of its agents: 󰔟
working,  waiting for you,  done and  failed or interrupted; the right
of the bar counts them. Done and failed clear once you have seen the pane.
The tabs ade opens for worktrees are named `project: worktree`, and the bar
groups them under the project's name, also when it has only one (a group of
one never collapses); in tab mode (`Ctrl-g`, `t`), `g` and `G` collapse or
expand the current group or all of them. Helix doesn't reload files agents
change: `Ctrl-r` reloads them all, dropping unsaved edits.

## How it fits together

- `config/` is stowed into `$HOME`:
  - `zellij/`: `config.kdl` (keys, session `main`), `layouts/dev.kdl` (the tab
    layout and the top bar), `yazi-picker.sh`, `resurrect-command.sh`;
  - `helix/`, `yazi/`, `tuicr/`, `git/`, `ghostty/`, `fzf/`, `glow/`;
  - `opencode/`: `cli.json.example`, the plugin links in `plugins/`, and
    `tui-plugins/btw-v2` (`/btw`, adapted from OpenCode's built-in);
  - `ade/config.json`: what differs from ade-kit's defaults (OpenCode through
    `opencode-pane`, tabs named `{project}: {worktree}`).
- `config/.local/bin/`: `ade` (a link to `packages/ade-kit/src/cli.ts`),
  `opencode-pane` (OpenCode in a pane, restorable after a restart) and
  `zellij-sync-bars`.
- `shell/*.zsh`: the zsh setup, the `wt*` functions (short names for `ade
  worktree`), `ocreload`, `zreset`, `gcai`, `mdview` and `cheat`.
- [`packages/`](packages), npm workspaces:
  - [`ade-kit`](packages/ade-kit): the `ade` command and library: adapters
    for the multiplexer, editor, agent and reviewer, and the worktree commands;
  - [`opencode-ade`](packages/opencode-ade): the OpenCode plugin with
    `show_file`, `delegate` and `status`;
  - [`opencode-ade-status`](packages/opencode-ade-status): done and failed
    statuses for the tabs, and OpenCode's sounds once, in the right tab;
  - [`opencode-ade-worktrees`](packages/opencode-ade-worktrees): OpenCode's
    own worktrees through ade-kit.
- The top bar is [ade-zjstatus](https://github.com/ag14774/ade-zjstatus), a
  zjstatus fork with agent statuses and tab groups, loaded by `dev.kdl` from
  its release URL.
- Secrets go in `~/.config/zsh/secrets.zsh` (from `secrets.zsh.example`), and
  machine-local shell code in `~/.config/zsh/local.zsh`; neither is tracked.

## Keeping it running

**Restarts.** Zellij saves `main` every 60 seconds. After a reboot, a crash or
`Ctrl-q`, the next terminal brings back its tabs, panes and folders: Helix
panes reopen the files they were started with, OpenCode panes continue their
folder's latest conversation, open floating panes reopen, and other panes come
back as shells (`resurrect-command.sh` decides what reruns). The last minute
before a crash can be missing. If Zellij can't start, the terminal falls back
to a plain shell; `zreset` clears the saved session. A brand-new session shows
a welcome screen: press `Esc` (`Enter` would install Zellij.app).

**Upgrading Zellij, or a new bar.** A running Zellij keeps its version, and
each saved tab keeps the bar it was opened with. Inside Zellij, run
`zellij-sync-bars --restart`: it saves and quits the session (closing its
terminal windows) and gives the saved tabs the bar from `dev.kdl`; then open a
terminal. `zellij-sync-bars --check` lists saved sessions with another bar. A
bar with a new release URL needs its permission granted once (above).

**After pulling.** Rerun `install.sh` (or its stow and `npm install` steps) so
new links exist. OpenCode's service keeps a plugin's server part until
`opencode service restart` (which interrupts running conversations; OpenCode
panes warn when it runs old code), and an OpenCode app loads the app parts
when it starts (`ocreload`).

## Tests

`npm test` runs every test that needs no Zellij session, OpenCode service or
model: the packages' node tests, and the zsh and python tests with stand-ins
for Zellij and OpenCode. `npm install && npm run check` type-checks the
packages.

The live tests take a few minutes each. They run in a sandbox
(`tests/lib/zellij-sandbox.zsh`: their own Zellij server, HOME and OpenCode
service), so they can run from inside Zellij and never reach your session or
service.

| After changing | Run |
| --- | --- |
| Zellij, Helix or OpenCode (upgrade), `dev.kdl`, `opencode-pane`, `resurrect-command.sh` | `zsh tests/zellij_restore_smoke.zsh` |
| Zellij, Helix, Yazi or tuicr (upgrade), the keys and their scripts | `zsh tests/keys_smoke.zsh` (a stand-in for OpenCode) |
| `opencode-ade`, `opencode-ade-status`, OpenCode (upgrade) | `zsh tests/ade_plugin_smoke.zsh` (nine short model calls) |
| `opencode-ade-status`'s sounds, OpenCode (upgrade) | `zsh tests/opencode_attention_smoke.zsh` |
| `opencode-ade-worktrees`, `ade worktree` | `zsh tests/opencode_worktrees_smoke.zsh` (no Zellij) |

## Changing the theme

Everything is Catppuccin Mocha, set per tool. `config/` is stowed, so edits
apply to the live config. The 16 base terminal colours come from the terminal
app. For another Catppuccin flavour, rename the themes below and replace the
Mocha hex values with the flavour's (<https://catppuccin.com/palette>).

Named themes:

| Tool | File | Setting | Apply |
| --- | --- | --- | --- |
| Helix | `config/.config/helix/config.toml` | `theme = "catppuccin_mocha_dim"` | `:config-reload` |
| Zellij | `config/.config/zellij/config.kdl` | `theme "catppuccin-mocha"` | a new session |
| Yazi | `config/.config/yazi/package.toml` and `theme.toml` | the flavour, in both | `ya pkg install`, restart Yazi |
| delta | `config/.config/git/config` | `syntax-theme = Catppuccin Mocha` | next `git diff` |

Hand-picked colours:

| What | File |
| --- | --- |
| Helix's dimmed docstrings | `config/.config/helix/themes/catppuccin_mocha_dim.toml` (inherits the stock theme; one green) |
| delta's gutters and blame | `config/.config/git/config`, `[delta "catppuccin-mocha"]` |
| glow (`cheat`, `Alt-/`) | `config/.config/glow/catppuccin-mocha.json`, named in `shell/cheatsheet.zsh` and `config.kdl` |
| `mdview`, `cheat --pretty` | `CHEATSHEET.css` |
| the top bar | `config/.config/zellij/layouts/dev.kdl`, the colours in the bar's `format_*`, `tab_*` and `attention_*` options |

Mocha: `base #1e1e2e` · `mantle #181825` · `crust #11111b` · `surface0 #313244` ·
`surface1 #45475a` · `surface2 #585b70` · `overlay0 #6c7086` · `text #cdd6f4` ·
`subtext0 #a6adc8` · `subtext1 #bac2de` · `red #f38ba8` · `maroon #eba0ac` ·
`peach #fab387` · `yellow #f9e2af` · `green #a6e3a1` · `teal #94e2d5` ·
`sky #89dceb` · `sapphire #74c7ec` · `blue #89b4fa` · `lavender #b4befe` ·
`mauve #cba6f7` · `pink #f5c2e7`
