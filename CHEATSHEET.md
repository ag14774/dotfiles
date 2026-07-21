# Terminal IDE Cheatsheet

Stack: **zellij** (multiplexer) + **Helix** (`hx`, editor) + **Yazi** (files) + **fzf** + **zoxide**.

**Legend:** `★` = custom to this setup · `Space` = leader key · `→` press keys in sequence · `·` separates alternatives · `⏎` Enter.
**Read this sheet:** `Alt-/` (floating) · `cheat` (pager) · `cheat --pretty` (browser, real fonts) · edit: `hx ~/dotfiles/CHEATSHEET.md`.

> **You don't need to memorize this.** Each tool is self-documenting: Helix `Space ?` (command palette), or press `Space` / `g` / `m` / `z` / `Ctrl-w` / `+`; Yazi `~` or `F1`; Zellij's bottom bar (unlock with `Ctrl-g`). This sheet just **surfaces the frequently-used keys** so you don't have to dig through those menus.

**How this sheet is laid out:** quick-lookup tables per tool (scan the left column for a key), then a **Recipes** section at the end for multi-step workflows and the "why."

---

## Daily glue (cross-tool)

The handful you reach for constantly. Each also has a home in its tool's section below.

| Key / cmd | Action |
|---|---|
| ★ `Alt-y` | Summon Yazi (zellij); the file you pick opens in the Helix pane |
| ★ `Ctrl-r` | Reload files from disk in Helix (after opencode edits them) |
| `gd` → `Ctrl-o` | Goto definition (incl. `.venv` libs), then jump back |
| ★ `j <dir>` · `ji` | zoxide jump · interactive jump (shell) |
| `git diff` | Review changes (delta, side-by-side) |
| ★ `gcai` | AI commit msg from staged diff → edit → commit (`gcai -y` = no edit; optional free-text arg adds prompt hints, e.g. `gcai 'note X is a placeholder'`) |

---

## Zellij

Default mode = **locked**, so keys pass through to Helix/Yazi. Unlock with `Ctrl-g` to drive zellij directly.

| Key | Action |
|---|---|
| `Ctrl-g` | Lock ⇄ unlock |
| `Alt-h/j/k/l` · `Alt-←↓↑→` | Move focus between panes / switch tab |
| ★ `Alt-y` | Yazi file picker (floating) |
| ★ `Alt-/` | This cheatsheet (floating; `q` closes) |
| `Alt-f` | Toggle floating panes |
| `Alt-n` · `Alt-t` | New pane · new tab |
| `Alt-[` · `Alt-]` | Previous · next swap layout |
| `Alt-=` · `Alt--` | Grow · shrink pane |
| `Ctrl-q` | Quit session (when unlocked) |

**Enter a mode after `Ctrl-g`:** `p` pane · `t` tab · `r` resize · `s` scroll · `m` move · `o` session.

| Mode | Keys |
|---|---|
| Tab | `n` new · `x` close · `r` rename · ★ `<` `>` move tab · `1`–`9` jump |
| Pane | `n` new · `x` close · `d`/`r` split down/right · `f` fullscreen · `w` floating · `c` rename |

---

## Helix

Modal: select → act. When stuck: `Space ?` (searchable command palette).

### Movement

| Key | Action |
|---|---|
| `h` `j` `k` `l` | left / down / up / right |
| `Nj` · `Nk` | go N lines down · up (matches the relative gutter number) |
| `w` `b` `e` | next word start / prev word start / word end |
| `W` `B` `E` | same, by WORD (whitespace-delimited) |
| `f` `t` `<char>` | find · till char (`F` `T` = backwards) |
| `Alt-.` | repeat last `f`/`t` |
| `gg` · `ge` | top · bottom of file |
| `G` · `:N`⏎ | go to line number N |
| `gh` · `gl` · `gs` | line start · line end · first non-whitespace |
| `Ctrl-d` · `Ctrl-u` | half-page down · up |
| `Ctrl-o` · `Ctrl-i` | jumplist back · forward (great after `gd`) |
| `%` | select the whole file |

### Editing

| Key | Action |
|---|---|
| `i` · `a` | insert before · after selection |
| `I` · `A` | insert at line start · end |
| `o` · `O` | open line below · above |
| `d` · `c` · `y` | delete · change · yank (to the `"` register) |
| `Alt-d` · `Alt-c` | delete · change **without yanking** (keeps `"`) |
| `p` · `P` | paste after · before |
| `r` · `R` | replace char · replace selection with the yank |
| `u` · `U` | undo · redo |
| `>` · `<` · `=` | indent · unindent · format selection |
| `~` | switch case |
| `Space y` · `Space p` · `Space R` | system-clipboard yank · paste · replace selection |
| `Ctrl-c` · `Space c` | toggle line comment (`Space C` = block) |

### Selection & multi-cursor

| Key | Action |
|---|---|
| `x` | select current line (`Nx` or repeat to extend down) |
| `v` | enter select/extend mode (movements now extend) |
| `s` | select all regex matches inside the selection |
| `C` · `Alt-C` | add cursor on next · previous line |
| `,` · `;` | keep only primary cursor · collapse to a single cursor |
| `Alt-;` | flip cursor ⇄ anchor (extend from the other end) |
| `miw` · `maw` | select inside · around word (`m` = match mode) |
| `mi(` `ma"` … | inside/around any pair (`mie` = value of a `.env`/config entry) |
| `ms<char>` | surround: add |
| `mr<a><b>` | surround: replace `a` → `b` |
| `md<char>` | surround: delete |

### Structural (tree-sitter)

| Key | Action |
|---|---|
| `maf` · `mif` | select around · inside function |
| `mac` · `mic` | around · inside class |
| `maa` · `mia` | around · inside argument/param |
| `Alt-o` · `Alt-i` | expand to parent node · shrink back |
| `Alt-p` · `Alt-n` | select previous · next sibling node |
| `]f` · `[f` | goto next · previous function |
| `]t` · `[t` | goto next · previous type/class |

### Search

| Key | Action |
|---|---|
| `/` · `?` | search forward · backward |
| `n` · `N` | next · previous match |
| `*` | set search pattern to current selection (writes the `/` register) |
| `Space /` | global search across the workspace |

### Registers

Prefix a yank/paste/delete with `"<reg>` (normal mode). Insert a register's text with `Ctrl-r <reg>` (insert mode & `:` prompts). Note: your ★ `Ctrl-r` = reload is normal-mode only.

| Key | Action |
|---|---|
| `"ay` · `"ap` | yank into · paste from named register `a` (any `a`–`z`) |
| `"+y` · `"+p` | copy · paste **system clipboard** (= `Space y` / `Space p`) |
| `"_d` · `"_c` | delete · change into the **black hole** (keeps your last yank) |
| `Ctrl-r "` | insert the last yanked text |
| `Ctrl-r #` | insert selection indices → 1, 2, 3… one per cursor |
| `Ctrl-r %` | insert the current file path |
| `Ctrl-r /` | insert the last search pattern |

### Code intelligence (LSP)

| Key | Action |
|---|---|
| `gd` · `gy` | goto definition · type-definition |
| `gr` · `gi` | goto references · implementation |
| `Space k` | hover docs / type |
| `Space a` | code action |
| `Space r` | rename symbol (project-wide) |
| `Space s` · `Space S` | document · workspace symbol picker |
| `]d` · `[d` | next · previous diagnostic |
| `Space d` · `Space D` | document · workspace diagnostics list |
| `Ctrl-u` · `Ctrl-d` | scroll a long hover / doc popup |

### Files & buffers

| Key / cmd | Action |
|---|---|
| `Space b` | buffer picker (jump to any open file) |
| `gn` · `gp` | next · previous buffer |
| `ga` | alternate file (jump back to the previous one) |
| `:w` · `:wa` | save current · save all |
| `:wq` · `:x` | save & close view |
| `:wqa` · `:xa` | save all & quit Helix |
| `:bc` · `:bc!` | close file · discard unsaved & close |
| `:bco` | close all other files |
| `:q` · `:q!` | close view · discard & close |

### Pickers (Space menu)

| Key | Action |
|---|---|
| `Space f` · `Space F` | file picker (workspace root · cwd) |
| `Space g` | changed-files picker (git) |
| `Space e` | file explorer |
| `Space '` | reopen last picker |
| `Space ?` | command palette (search every command + its key) |

In a picker: `Ctrl-n`/`Ctrl-p` or arrows move · `Enter` open · `Ctrl-s`/`Ctrl-v` open in split · `Ctrl-t` toggle preview · `Esc` close.

### Git changes (gutter)

| Key | Action |
|---|---|
| `]g` · `[g` | next · previous change |
| `]G` · `[G` | last · first change |

Change bars (added / modified / deleted) show in the gutter automatically. See the Recipes section for the full review workflow.

### ★ Custom keys

| Key | Action |
|---|---|
| ★ `Ctrl-↑` · `Ctrl-↓` | move current line / selection up · down |
| ★ `Ctrl-r` | `:reload-all` (re-read files changed on disk) |
| ★ `+` `f` | format the whole file |
| ★ `+` `s` | toggle soft-wrap |
| ★ `+` `l` | toggle inlay type hints |
| ★ `+` `d` | toggle end-of-line diagnostic text |
| ★ `+` `w` · `+` `W` | show · hide whitespace |

---

## Yazi (via ★ `Alt-y`)

| Key | Action |
|---|---|
| `h` `j` `k` `l` | up dir / down / up / into dir |
| `gg` · `G` | top · bottom |
| `H` · `L` | back · forward (history) |
| `Enter` | open the file in Helix (picker mode) |
| `Space` | toggle selection (`Ctrl-a` all · `Ctrl-r` invert) |
| `y` · `x` · `p` | yank · cut · paste |
| `d` · `D` | trash · delete! |
| `a` · `r` | create · rename |
| `.` | toggle hidden files |
| `f` · `/` | filter · find in current dir |
| `s` · `S` | search files (fd) · contents (rg) |
| ★ `z` | fzf jump (★ `Alt-g` inside toggles `.gitignore`) |
| `Z` | zoxide jump |
| `~` · `F1` | help (searchable); `q` quits |

Files show ★ git status signs (M/A/D/…) automatically, a quick "what changed" view.

## fzf (inside Yazi `z`)

Type to filter · `Ctrl-n`/`Ctrl-p` or arrows move · `Enter` select · `Tab` multi-select · `Esc` cancel.
★ `Alt-g` toggles whether `.gitignore`d files show (prompt flips `git>` ⇄ `all>`).

---

## Recipes

Multi-step workflows and the reasoning. The individual keys are in the tables above.

### Helix

**Select N lines from here:** `Nx` (e.g. `5x`). `x` grabs the current line; the count or an extra `x` adds lines below.

**Copy lines to another file:** `Nx` → `Space y` → `:open other`⏎ → `Space p`.

**Replace a config value with the clipboard:** `gl` → `mie` → `Space R`. Works in `.env`/toml/yaml (tree-sitter); `gl` lands on the value; use `mi"` to keep the quotes.

**Edit every occurrence of a word (like VSCode Ctrl-D):** `miw` (or double-click) → `*` → `v` → `n` `n` `n` … → `c`/`d`. Why `*`: it stashes the selection in the `/` search register, so each `n` jumps to the *same* word and extends the multi-selection.

**Extend a selection upward (grab lines above):** `Alt-;` (moves the cursor to the top end) → `v` → `k` per line → `X` to snap to whole lines.

**Select a function with its decorator:** `maf` → `Alt-o`. `maf` alone stops at the `def`; `Alt-o` grows to the decorated block. Repeat `Alt-o` to widen, `Alt-i` to shrink.

**Read a long diagnostic cut off at the line end:** move the cursor onto that line and the full message wraps in below it. ★ `+` `d` toggles the end-of-line text. `Space d` only *jumps* to diagnostics. The statusline counts the current file only, so use `Space D` for the project-wide total.

**Sort imports + drop unused (Python):** `Space a` → *Ruff: Organize imports* (or *Fix all*) → `:w`. On `:w`, ruff only **formats** (like Black); it does not sort or prune imports. To automate, chain `ruff check --fix` into `ruff format` via `formatter` in `~/.config/helix/languages.toml`.

**Registers hiding in the tables above:** `Space y`/`Space p`/`Space R` are the `+` clipboard register. `R` *reads* the `"` register; `Alt-d`/`Alt-c` delete/change *without writing* `"` (same effect as `"_d`/`"_c`).

### Reviewing opencode's changes

1. **What changed** — `Alt-y` (Yazi git signs) or `Space g` in Helix.
2. **Open it** — pick the file, then ★ `Ctrl-r` to reload from disk.
3. **What lines** — skim the gutter bars; `]g`/`[g` to hop between changes.
4. **Exact diff** — `git diff` (or `git diff HEAD`) in a pane (delta, side-by-side).
