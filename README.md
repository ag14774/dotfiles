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
flavor, symlinks `config/` into `~/.config` and `~/.local/bin` via GNU Stow, and appends a small
configuration block to `~/.zshrc` (adds the managed user-tool directories to `PATH`, sources
`~/.config/zsh/secrets.zsh`, and loads the `shell/*.zsh` functions). A separate
managed preamble is kept at the beginning for Zellij autostart; it also sets
`PATH` and `EDITOR` (the available Helix executable) first, so Zellij and the
panes it restores get them. If the account's
login shell is not zsh, the installer changes it permanently with `chsh`;
`exec zsh` enters zsh immediately without waiting for the next login. Run the
installer as your normal user, not with `sudo`; it elevates package installation
itself when needed.

Homebrew must already be installed on macOS. The Linux backends support Debian
13 (Trixie, amd64 only) and Pacman-based distributions such as Manjaro and Arch Linux.
Because several tools are not in Debian 13, its backend installs Yazi, Zellij,
tuicr, Taplo, and Marksman from their upstream GitHub releases. Ghostty uses
the community Debian package linked from
[Ghostty's official installation docs](https://ghostty.org/docs/install/binary#debian-and-ubuntu).

Debian's packaged Helix is too old for the shared configuration. `install/apt.sh`
installs the upstream Helix **25.07.1** `.deb` through APT, replacing Debian's `hx`
package. **The Debian Helix version is hardcoded and must be bumped manually:**
update `HELIX_VERSION`, `HELIX_DEB_VERSION`, and `HELIX_SHA256` in that script,
then rerun the installer. Normal APT upgrades do not track upstream Helix releases.
The pinned release has no arm64 `.deb`, so the Debian installer rejects arm64
before making package changes. Homebrew and Pacman continue to use their repositories.

### Managed developer tools

The installer keeps user-level tools with the package manager for their
ecosystem:

| Manager | Installed by | Managed tools |
| --- | --- | --- |
| Homebrew/Pacman | platform backend | Node/npm, Ruff, Taplo, Marksman, ShellCheck, shfmt, GitHub CLI |
| APT | `install/apt.sh` | Node/npm (NodeSource's repository, current LTS), ShellCheck, shfmt, GitHub CLI |
| Upstream release assets | `install/apt.sh` | Helix (pinned `.deb` via APT), Yazi, Ghostty, Zellij, tuicr, Taplo, Marksman on Debian |
| Official uv installer (`~/.local/bin`) | `install.sh` | uv |
| `uv tool` | `install.sh` | Pyright, plus Ruff on Debian |
| npm (`~/.local`) | `install.sh` | TypeScript plus bash/yaml/json language servers |
| Official OpenCode V2 installer (`~/.opencode/bin`) | `install/opencode.sh` | OpenCode 2 |
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

### Restoring Zellij after a restart

Every terminal attaches to one session, `main`. Zellij saves it every 60
seconds (the first save happens a minute after it starts), so after a reboot,
a crash or quitting it with `Ctrl-q`, the next terminal brings back its tabs,
panes and directories, with these programs running again:

- Helix panes reopen the files they were started with; files opened later and
  unsaved edits are lost.
- OpenCode panes continue the most recent conversation in their directory
  (`gcai` deletes its own drafting sessions so they never take that place).
- Panes you started a program in from their shell come back as plain shells:
  dev servers, `git log`, scripts and the like are deliberately not rerun.
- Floating panes that were open, such as the `Alt-y` picker or the `Alt-/`
  cheatsheet, open again. A Helix `+ r` run pane does not rerun its code.

Panes started with a program are saved with their own command line: Helix, and
OpenCode through `opencode-pane`, which always saves itself as
`opencode-pane --resume`. For programs you start from a shell,
`config/.config/zellij/resurrect-command.sh` decides what is rerun; extend its
allow-list if you want more. Keep that hook cheap: Zellij also runs it for
`list-panes` and waits only 100 ms. A restored OpenCode pane stays open as
"exited" after you quit OpenCode (`ocreload` replaces it), and changes made in
the last minute before a crash can be missing. New tabs (`Alt-t`, tab-mode `n`,
`wt -t/-b`) are built from `dev.kdl` itself, because a restored session's saved
new-tab template starts its commands suspended. If Zellij cannot start, for
example because the saved session is unreadable, the terminal falls back to a
plain shell. `zreset` deletes the saved session for a clean start.

After upgrading Zellij, Helix or OpenCode, run `zsh tests/zellij_restore_smoke.zsh`.
It saves, kills and restores a throwaway session (never `main`) and checks that
all of the above still holds. After upgrading OpenCode or changing the ADE
plugin, also run `zsh tests/ade_plugin_smoke.zsh` (see "OpenCode agents and Zellij").
After changing `packages/`, run `node --test` in `packages/ade-kit` and in
`packages/opencode-ade-status` (Node's own test runner, no dependencies).
After upgrading Zellij, Helix, Yazi or tuicr, or changing the scripts behind
the keys, run `zsh tests/keys_smoke.zsh`: it checks `Alt-y`, Helix's `+ a` and
the `Alt-v` review end to end in a throwaway session, with a stand-in for
OpenCode (no model calls).

The top bar (zjstatus) shows the mode, the tabs (with the agent icons above) and
an `Alt-t` hint on the left, and on the right how many tabs are waiting, failed,
done or working (counted from those icons by the status plugin's server part and
sent with `zellij pipe` whenever one changes). It has no clock: zjstatus redraws
only on Zellij events, so a clock went stale while the session was idle. It is loaded by `dev.kdl`
straight from its release URL, so
the first time you must grant its plugin permission once (the installer prints
this): inside a zellij session run
`zellij plugin -f -- "<zjstatus-url>"`, press `y`, then close that pane.

## Layout

- `config/.config/{ghostty,zellij,helix,yazi,opencode}/` — stowed into `~/.config`
- `config/.local/bin/` — reusable commands, stowed into `~/.local/bin` (on `PATH`
  for shells, Zellij, and programs started from them):
  - `wt-core` — the worktree engine behind the `wt*` shell commands
    (`wt-core help`); the shell functions are thin wrappers that `cd` for you.
    For scripts and agents, stdout carries only the result (such as the
    worktree path) and progress goes to stderr
  - `hx-open FILE...` — open files in the current Zellij tab's Helix `editor`
    pane, spawning it if needed (used by the `Alt-y` picker and the ADE
    plugin). The tab is the one of `$ZELLIJ_PANE_ID`; it refuses to guess when
    that pane is gone, and never switches you to another tab: in a tab you are
    not on, it only uses an existing editor, without focusing it
  - `opencode-send FILE [START [END [LANGUAGE]]] [< SELECTION]` — paste a
    reference (`FILE:START-END`) and the selection, as a fenced block, into the
    current tab's OpenCode prompt and focus it; nothing is submitted. Not tied to
    an editor; Helix calls it from `+ a` (see "OpenCode agents and Zellij").
    `opencode-send --text < TEXT` pastes text as it is (the `Alt-v` review)
  - `opencode-pane [--session ID] [--prompt PROMPT] | --resume` — run OpenCode
    in a pane with your shell environment, optionally on a given conversation,
    in a way Zellij restores as `--resume`, which continues the directory's
    latest conversation; a prompt is never resent (used by the layout,
    `ocreload`, `wt -p` and `wt --session`)

  The `wt*` functions, `ocreload` and the `Alt-y` picker call this checkout's
  copies directly. Rerun `install.sh` (or its stow step) to put new commands on
  `PATH`.
- `shell/*.zsh` — sourced directly by the `.zshrc` block
- `install/{apt,brew,pacman}.sh` — platform package installation backends
- `Brewfile` — Homebrew package manifest
- `secrets.zsh.example` — template; real secrets live in
  `~/.config/zsh/secrets.zsh` (gitignored, never committed)

### OpenCode 2 migration

The installer uses the [V2 installer](https://opencode.ai/v2/install), currently
the 2.x channel, rather than V1's GitHub latest release. Set
`OPENCODE_VERSION=2.0.24 ~/dotfiles/install.sh` to select a specific stable 2.x
release. A new binary is staged and its version verified before replacement.
Package-managed OpenCode installations must be removed first; the script reports
the conflict instead of overwriting their binaries.

Before replacing OpenCode or creating V2 client settings, the installer creates a
private backup under `~/.local/state/opencode/dotfiles-backups/` (respects XDG).
It includes the old binary, global configuration, credentials, shell startup file,
persisted UI preferences, and a consistent SQLite backup including committed WAL
transactions. Configuration-file symlinks are copied as snapshots. Existing
`opencode.json(c)`, agents, commands, skills and credentials stay in V1-compatible
form; V2 loads them without requiring a native-format rewrite.

If `cli.json` is absent, supported global `tui.json(c)` settings and persisted
preferences are migrated into it and validated against V2's published schema,
with the [BTW plugin](#opencode-btw) enabled.
An existing `cli.json` is validated and preserved on reruns, except for replacing
an old BTW plugin file reference if V2 already auto-migrated it. This is a real file,
owned by the client; `cli.json.example` documents the defaults. Other V1 plugins
are reported and left in the original V1 file, since their implementation must be
ported before V2 can load them.

Restart OpenCode after installation. V2 imports V1 session data on startup.
For V2 `2.0.24`, the installer starts the shared service and repairs the known
[Azure credential migration bug #53443](https://github.com/anomalyco/opencode/issues/53443).
It moves the migrated Azure `resourceName` form answer into a new credential's
`configuration`, activates it, and retains the original credential plus a private
JSON backup. The repair is idempotent and does not edit the database directly.
It also backs up and removes imported Vertex API-key credentials when existing
Google ADC can successfully refresh a token. Claude on Vertex requires ADC;
an imported API key prevents the V2 provider from using it. If ADC is unavailable,
the key is preserved and the installer prints the required setup step.
Verify provider credentials, models and MCP connections in your project.
V2 has no OpenCode LSP tools or diagnostics; use project lint/typecheck commands
(Helix's language servers are independent). Shell completions support both versions.
`gcai` uses the still-supported `run --format json` text-event contract.
`ocreload` reloads V2's shared server configuration before replacing the client pane.

For rollback, quit V2 and stop its service (`opencode service stop`), restore the
backup binary into `~/.opencode/bin/opencode`, restore global configuration and
credentials from the backup, and restore the database while all OpenCode processes
are stopped. Remove stale database `-wal`/`-shm` files before restoring it. The V1
`tui.json` remains available, but the V1 BTW plugin was removed. See the
[upstream migration guide](https://opencode.ai/v2/docs/migrate-v1/).

### OpenCode agents and Zellij

OpenCode itself knows nothing about Zellij, and an agent's commands are started
by OpenCode's shared background service, not by your pane. So agents act on
your Zellij through the ADE plugin instead of running Zellij scripts: its tools
ask the OpenCode app in the pane showing the conversation (for a subagent, its
parent's pane) to do the work with that pane's own environment. One pane
carries it out (the first to claim it), and the agent is told what happened,
including "no OpenCode pane in Zellij is showing this conversation".

- `show_file` opens files in the tab's Helix (`hx-open`), also after `/cd`.
- The other way round, in Helix press `+` then `a` to ask this tab's OpenCode
  about the code: it gets `file:line`, or for a selection `file:start-end` and
  the selected text (shown as `[Pasted ~N lines]`, unsaved edits included), and
  becomes the focused pane for your question. Only the primary selection is
  sent. Helix doesn't reload files agents change: `Ctrl-R` reloads them all
  (`:reload-all`, which discards unsaved edits), and Helix refuses to save over
  a file changed on disk unless you use `:w!`.
- `delegate` starts work in another worktree: say "delegate this", "do this in
  a new worktree", or use `/delegate [what]`. It runs `wt-core open --prompt
  BRIEF BRANCH` from the pane, so a background tab opens for the worktree and its
  OpenCode starts on a brief the agent writes. The calling conversation stays
  where it is and isn't told when the new one finishes. (In a plain clone, as
  with `wt`, the worktree goes inside the repository folder.)
  - Say "with the context" (or "with a summary") to carry this conversation
    over: the pane first creates the worktree (`wt-core open --stay`), copies
    the conversation up to your request into it (compacting the copy for a
    summary), and the same `wt-core open --prompt` runs with `--session COPY`.
    The original conversation stays in its tab, unchanged.
  - OpenCode's own `worktree_create`/`worktree_list` tools are hidden from
    agents: they make detached worktrees elsewhere, without a tab.
- `status` answers "how are the other worktrees doing?" from any tab: for each
  of the project's worktrees, its branch, uncommitted changes, commits ahead of
  `origin/HEAD`, whether it has a tab (`wt-core ls --json`, run from the pane),
  and its latest conversation: working, waiting for you (a permission request
  or question), idle, failed or interrupted, with the start of its last answer.
  Read-only; a tab you only use to delegate and ask this acts as a coordinator.
- Each tab's name shows what its OpenCode is doing, with a Nerd Font icon in
  front: 󰔟 working,  waiting for you (a permission request or question),
   done and  failed or interrupted. Done and failed show only if the tab
  wasn't active when the work ended, and clear when you visit it. The app in
  the pane renames its own tab (`rename-tab-by-id`); with several OpenCode
  panes in a tab, the most urgent state wins. Nothing relies on the names;
  `wt` finds tabs by directory. This is the status plugin,
  `packages/opencode-ade-status`, a package built on `packages/ade-kit`
  (which reads the optional `~/.config/ade/config.json`; its defaults are this
  setup). Stow links it as `~/.config/opencode/plugins/ade-status` (a link
  committed under `config/`), which loads both its parts.
- Each conversation a pane in Zellij shows gets short instructions about this
  setup (tabs, `show_file`, `status`, delegating only when asked), as a per-conversation
  instruction entry rather than a global `AGENTS.md`, so OpenCode elsewhere
  never sees them.
- The server part (`plugins/ade.ts`, loaded automatically) also removes the
  Zellij variables from the service's own environment. A conversation that
  never had a pane (a subagent, a fork not yet opened) would otherwise get the
  variables of whichever pane started the service, and act on that pane's tab.
- The app part (`tui-plugins/ade`) is listed in `cli.json`; the installer adds
  it. `rpc.ts` holds the calls between the two parts; its `show_file`,
  `delegate` and `status` methods do what the tools do, for scripts, e.g. `opencode api POST
  "/api/rpc/ade/show_file?location%5Bdirectory%5D=DIR" -d
  '{"input":{"sessionID":"ses_…","paths":["/abs/file"]}}'` (RPC calls take
  their folder from `location[directory]`, not `directory`).

Agents can still run `hx-open` or `wtrm` through the shell: `hx-open` refuses
when `$ZELLIJ_PANE_ID` no longer exists, and `wtrm`/`wtprune` close no tabs when
run by an agent (OpenCode marks its commands with `OPENCODE_TERMINAL=1`) or
when that pane no longer exists.

The service keeps the server part it first loaded: OpenCode reloads changed
plugins, but not symlinked ones like ours. When the files differ from what the
service runs, OpenCode panes say so in a warning; run `opencode service
restart` (this interrupts running conversations). The status plugin, a package
directory, is reloaded when its own files change, but not when `ade-kit`
changes; it warns the same way. `tests/ade_plugin_smoke.zsh`
tests this checkout's plugin with a private OpenCode service and a throwaway
Zellij session, so it needs no restart and never touches your session or
service. It makes six short model calls.

### OpenCode BTW

The OpenCode TUI plugin provides `/btw` for side questions. V2 adapts the
[built-in BTW plugin](https://github.com/anomalyco/opencode/blob/v2/packages/tui/src/feature-plugins/prompt/btw.tsx):
it uses the current session's context and model through transient `session.generate`
calls, without running tools or adding messages to the main conversation.
The dialog renders Markdown with tables, scroll controls, copy, and follow-ups.
Press `f` or Enter to write a follow-up, Enter to send, `c` to copy the latest
answer while reading (`Ctrl+Y` while typing), and Esc to close. Side-conversation
history stays only in the dialog and is discarded on close; no temporary session
is created. A `/btw` spinner in the prompt footer indicates pending requests.
V2 loads `btw-v2/tui.tsx` through the `btw-v2/` plugin directory and disables
the built-in one-shot `opencode.btw`, so `/btw` always means this plugin. The
installer deletes older BTW plugin files (`btw.tsx`, `btw-v2.tsx`) from
`~/.config/opencode/tui-plugins/`.

To test the built-in without changing settings, launch
`OPENCODE_CLI_CONFIG_CONTENT='{"plugins":["opencode.btw"]}' opencode`.
To test the custom plugin, launch `opencode`, open a session, and run
`/btw What is 2 + 2?`. After the answer appears, press `f` and ask `Multiply that by 3`
in the follow-up input, then press Esc to close the temporary conversation.

### Reading Markdown

Run `mdview` in a repo to open its README in your browser, or
`mdview docs/guide.md` for another file. In Helix, press `+` then `m` to preview
the saved file; use `Alt-y` to pick it first if needed. The preview uses
Catppuccin styling and embeds images relative to the document's directory.
Fenced `mermaid` blocks render as diagrams using Mermaid 12.2.0, loaded from
jsDelivr in the browser (internet access required; diagram source stays local).
If loading or rendering fails, the source remains visible with an error message.
Save edits and preview again to update it (no live reload).
The same renderer powers `cheat --pretty`.

### Worktree tabs

`wt <branch>` changes into the branch's worktree, creating it if needed. Choose
a different landing with `-s` (stay here and print the path), `-t` (focus the
worktree's Zellij tab, opening one with OpenCode if needed), or `-b` (open that
tab in the background). `wt -p "fix the flaky test" <branch>` opens a background
tab whose OpenCode immediately starts on the prompt; `--session ID` (with or
without `-p`) opens it on an existing OpenCode conversation. `wtreview` accepts
the same options. Outside Zellij, `-t` changes directory, `-b` stays, and `-p`
fails.

A worktree's tab is any tab whose panes are all inside the worktree's
directory; names and tab IDs play no part, so renaming a tab or restoring the
session changes nothing. Opened tabs are named after the worktree directory
only for display. `-t` returns to that tab later; `wtrm` and `wtprune` close the
worktree's tabs with it (their shells would be left in a deleted directory),
except the tab you run them from. Tabs with a pane elsewhere, such as a tab
where one shell `cd`'d into the worktree, are never focused or closed. Options
go before the branch.

### Reviewing changes

`Alt-v` opens a [tuicr](https://tuicr.dev) review of the worktree of the pane
you are in, in a floating pane: everything it changed since it left the
remote's default branch (`origin/HEAD`, the base `wt` uses), committed or not.
That covers an agent's commits, which Helix's gutter no longer shows.
In a `wtreview` worktree, it shows the PR plus your own edits.

In tuicr, `c` comments on a line, `v` selects lines for a range comment, `e`
opens the file in the tab's editor pane (`Alt-v` brings the review back), and
`y` ends the review and pastes your comments into the tab's OpenCode prompt,
ready to send. `:q` quits without sending. `zsh tests/review_scope.zsh` checks
what the review covers.

Yazi marks the same changes: git.yazi's yellow, green, red and magenta signs
for uncommitted changes, and, to their left, the same signs in blue for what
the branch's commits changed since `origin/HEAD` (a local plugin,
`config/.config/yazi/plugins/git-branch.yazi`). Like git.yazi, an open Yazi
picks up a new commit when you re-enter the folder; each `Alt-y` starts fresh.

### Pull request worktrees

`wtreview <number-or-url>` creates a detached `review-pr-<number>` worktree
whose `HEAD` is the PR merge base while its index and files are the PR head.
Helix therefore shows the complete PR in its Git gutter. In this mode,
`git diff --cached` is the original PR and `git diff` is only your own edits.
Configured worktree seed files are copied immediately; unchanged seeds are
treated as review baseline, while modified seeds are protected as personal data.

Run `wtchange` inside that worktree before committing or pushing. It attaches
the original PR branch, configures its upstream (including contributor forks),
and preserves staged and unstaged review edits. `ggpush` and `ggpull` use the
configured upstream; both refuse detached review mode. `wtprune --merged`
removes clean review worktrees after their exact PR head is merged, but leaves
reviews with personal edits alone.

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
  (Helix) pane, and `Alt-v` reviews the tab's changes in tuicr (see "Reviewing
  changes"); `dev.kdl` uses a swap layout (editor top / terminal bottom /
  opencode right).
