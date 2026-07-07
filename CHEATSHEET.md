# Terminal IDE Cheatsheet

Stack: **zellij** (multiplexer) + **Helix** (`hx`, editor) + **Yazi** (files) + **fzf** + **zoxide**.
`★` = custom to this setup. Open this anytime: `hx ~/dotfiles/CHEATSHEET.md`.

> **You don't need to memorize most of this.** Each tool is self-documenting:
> - Helix: press `Space`, `g`, `m`, `z`, `Ctrl-w`, or `+` and a menu pops up. `Space ?` = searchable command palette.
> - Yazi: `~` (or `F1`) opens a searchable keymap.
> - Zellij: the bottom bar shows the current mode's keys (press `Ctrl-g` to unlock first).

---

## Daily glue (the cross-tool bits)

| Key / cmd | Where | Action |
|---|---|---|
| ★ `Alt-y` | zellij | Summon Yazi; the file you pick opens in the Helix **editor** pane |
| ★ `Ctrl-r` | Helix | Reload files from disk (after opencode edits them) |
| `Space g` | Helix | Pick from git-**changed** files |
| `gd` … `Ctrl-o` | Helix | Goto definition (incl. into `.venv` libs) … jump back |
| `git diff` | terminal | Review changes (rendered by delta, side-by-side) |
| ★ `j <dir>` / `ji` | shell | zoxide jump / interactive jump |

---

## Zellij  (default mode = **locked** → keys pass through to Helix/Yazi)

| Key | Action |
|---|---|
| `Ctrl-g` | Lock ⇄ unlock (unlock to drive zellij directly) |
| `Alt-h/j/k/l` or `Alt-←↓↑→` | Move focus between panes / switch tab |
| ★ `Alt-y` | Yazi file picker (floating) |
| `Alt-f` | Toggle floating panes |
| `Alt-n` / `Alt-t` | New pane / new tab |
| `Alt-[` / `Alt-]` | Previous / next swap layout |
| `Alt-=` / `Alt--` | Grow / shrink pane |
| `Ctrl-q` | Quit session (when unlocked) |

**After `Ctrl-g` (unlocked), enter a mode:** `p` pane · `t` tab · `r` resize · `s` scroll · `m` move · `o` session.
In tab mode: `n` new, `x` close, `r` rename, ★ `<` / `>` move tab left/right, `1..9` jump.
In pane mode: `n` new, `x` close, `d`/`r` split down/right, `f` fullscreen, `w` floating, `c` rename.

---

## Helix — movement

| Key | Action |
|---|---|
| `h j k l` | left / down / up / right |
| `w` `b` `e` | next word start / prev word start / word end (`W B E` = WORD) |
| `f`/`t` `<char>` | find / till char (`F`/`T` = backwards); `Alt-.` repeat |
| `gg` / `ge` | top / bottom of file; `G` = go to line number |
| `gh` / `gl` / `gs` | line start / line end / first non-whitespace |
| `Ctrl-d` / `Ctrl-u` | half-page down / up |
| `Ctrl-o` / `Ctrl-i` | jumplist back / forward (great after `gd`) |
| `%` | select whole file |

## Helix — editing

| Key | Action |
|---|---|
| `i` `a` / `I` `A` | insert before/after selection · at line start/end |
| `o` / `O` | open line below / above |
| `d` / `c` / `y` | delete / change / yank (to internal register) |
| `p` / `P` | paste after / before |
| `r` / `R` | replace char / replace with yanked |
| `u` / `U` | undo / redo |
| `>` / `<` / `=` | indent / unindent / format selection |
| `~` | switch case |
| `Space y` / `Space p` | yank / paste **system clipboard** |
| `Space c` | toggle comment |
| ★ `Ctrl-↑` / `Ctrl-↓` | move current line / selection up / down |

## Helix — selection & multiple cursors (Helix is select→act)

| Key | Action |
|---|---|
| `x` | select current line (repeat to extend down) |
| `v` | enter select/extend mode (movements now extend) |
| `s` | select all regex matches **inside** selection |
| `C` / `Alt-C` | add cursor on next / previous line |
| `,` / `;` | keep only primary cursor / collapse to single cursor |
| `miw` / `maw` | select inside / around word (`m` = match mode; also `mi(`, `ma"`, …) |
| `ms<char>` / `mr<a><b>` / `md<char>` | surround add / replace / delete |

**★ Select word → add each next occurrence (VSCode Ctrl-D):**
`miw` (or double-click) → `*` → `v` → `n` `n` `n` … then `c`/`d` to edit them all.

## Helix — search

| Key | Action |
|---|---|
| `/` `?` | search forward / backward |
| `n` / `N` | next / previous match |
| `*` | set search pattern to current selection |
| `Space /` | global search across the workspace |

## Helix — code intelligence (LSP)

| Key | Action |
|---|---|
| `gd` `gy` `gr` `gi` | goto definition / type-def / references / implementation |
| `Space k` | hover docs / type |
| `Space a` | code action |
| `Space r` | rename symbol (project-wide) |
| `Space s` / `Space S` | document / workspace symbol picker |
| `]d` / `[d` | next / previous diagnostic |
| `Space d` / `Space D` | document / workspace diagnostics list |

## Helix — pickers (Space menu)

| Key | Action |
|---|---|
| `Space f` / `Space F` | file picker (workspace root / cwd) |
| `Space b` | buffer picker |
| `Space g` | changed-files picker (git) |
| `Space e` | file explorer |
| `Space '` | reopen last picker |
| `Space ?` | command palette (search every command + its key) |

In a picker: `Ctrl-n`/`Ctrl-p` or arrows move · `Enter` open · `Ctrl-s`/`Ctrl-v` open in split · `Ctrl-t` toggle preview · `Esc` close.

## Helix — ★ custom keys

| Key | Action |
|---|---|
| ★ `Ctrl-↑` / `Ctrl-↓` | move line / selection up / down |
| ★ `Ctrl-r` | `:reload-all` (re-read files changed on disk) |
| ★ `+` `f` | format the whole file |
| ★ `+` `s` | toggle soft-wrap |
| ★ `+` `l` | toggle inlay type hints |
| ★ `+` `d` | toggle end-of-line diagnostics (harper grammar text) |
| ★ `+` `w` / `+` `W` | show / hide whitespace |

## Helix — reviewing git changes

- Change bars show in the gutter automatically (added / modified / deleted).
- `]g` / `[g` — jump to next / previous change (`]G` / `[G` = last / first).
- ★ `Ctrl-r` first, so the buffer + bars reflect opencode's on-disk edits.
- `Space g` — jump straight to a changed file.
- For the actual before/after: `git diff` in a pane (delta shows it side-by-side).

---

## Yazi  (opens via ★ `Alt-y`)

| Key | Action |
|---|---|
| `h j k l` | up dir / down / up / into dir; `gg` / `G` top / bottom |
| `H` / `L` | back / forward (history) |
| `Enter` | choose file → opens in Helix (picker mode) |
| `Space` | toggle selection; `Ctrl-a` all; `Ctrl-r` invert |
| `y` `x` `p` | yank / cut / paste; `d` trash; `D` delete!; `a` create; `r` rename |
| `.` | toggle hidden files |
| `f` / `/` | filter / find in current dir |
| `s` / `S` | search files (fd) / search contents (rg) |
| ★ `z` | fzf jump (★ `Alt-g` inside = toggle `.gitignore`, prompt `git>`/`all>`) |
| `Z` | zoxide jump |
| `~` / `F1` | help (searchable) · `q` quit |

★ Files show **git status signs** (M/A/D/…) automatically — quick "what changed" view.

---

## fzf  (used inside Yazi `z`)

Type to filter · `Ctrl-n`/`Ctrl-p` or arrows to move · `Enter` select · `Tab` multi-select · `Esc` cancel.
★ `Alt-g` = toggle whether `.gitignore`d files show (prompt flips `git>` ⇄ `all>`).

---

## Reviewing opencode's changes — recipe

1. **What files** — `Alt-y` (Yazi git signs) or `Space g` in Helix.
2. **Open one** — pick it; then `Ctrl-r` to reload from disk.
3. **What lines** — skim the gutter bars; `]g` / `[g` to hop between changes.
4. **Exact diff** — `git diff` (or `git diff HEAD`) in a pane → delta, side-by-side.
