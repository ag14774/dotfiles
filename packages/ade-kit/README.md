# ade-kit

The core of a terminal "agentic development environment": a library and the
`ade` command that tie a terminal multiplexer, an editor, a coding agent and a
code reviewer to git worktrees. Each tool is an adapter; the built-ins are
Zellij, Helix (and Mitos), OpenCode and tuicr, and worktrees can be laid out
three ways.

It needs Node 23.6 or newer (it runs its TypeScript directly, with no build
step) and git, and uses only Node's built-in modules. The Zellij adapter needs
Zellij 0.46; `ade worktree prune -m` needs the GitHub CLI.

## Installing

From a checkout: put `src/cli.ts` on your `PATH` as `ade` (a symbolic link is
enough). Code in the same repository imports it as `ade-kit` once the
repository root's `npm install` has linked the workspace packages (it
downloads nothing). Node refuses to run TypeScript from inside `node_modules`,
so `ade-kit` isn't installable from npm as it is.

## The `ade` command

Results go to stdout and messages to stderr; the exit status is 2 for wrong
usage and 1 when the action fails. `ade help` and `ade worktree help` list
everything.

| Command | What it does |
| --- | --- |
| `ade open FILE[:LINE[:COLUMN]]...` | Opens the files in the editor of its own tab and focuses it. With no editor in the tab, it starts one there. It never switches tabs: in a tab you are not on, it only uses an editor that is already there, without focusing it. An editor that can't open a file at a line gets the file without it. |
| `ade send FILE [START [END [LANGUAGE]]] [< SELECTION]` | Puts a reference to those lines of the file (`FILE:START-END`) and the selected text, as a fenced block, in the prompt of the tab's agent, and focuses the agent. Nothing is sent: you add your question. |
| `ade send --text [--submit] < TEXT` | Puts the text in the agent's prompt as it is; with `--submit`, sends it. |
| `ade review` | Reviews what the worktree changed since `worktrees.base`, committed or not, in the configured reviewer (tuicr by default), in the terminal it runs in. When you end the review, your comments go to the tab's agent: filled in for you to send, or sent (`review.deliver`). With nothing to review, it says so. If the tab already has a review open, it shows that one. The worktree is that of the folder `ade where` prints. |
| `ade review --scope` | Prints what a review here covers: `-r BASE..HEAD` for the commits since `worktrees.base`, `-w` for uncommitted changes. |
| `ade restart-agent [DIR]` | Replaces the tab's agent with a fresh one started in `DIR` (default: the current folder), in the same place; a tab without an agent gets one (with Zellij, on the right: `zellij.newPanes`). Focus stays where it is. |
| `ade where` | Prints the folder of the focused tiled pane of its own tab; if that pane reports no folder, the tab's agent pane's, then its shell pane's. Outside a multiplexer, or when that folder no longer exists, it prints the folder it was started in. So in a tiled pane you get your own folder, and in a floating pane opened by a key (which starts in the session's folder) the folder of the focused tiled pane underneath. |
| `ade worktree COMMAND` | Creates, opens, lists and removes worktrees: below. |

Set `ADE_LOG=FILE` to append each command `ade` runs to a file, and
`ADE_CONFIG=/abs/path.json` to read another config.

## Worktrees

- `ade worktree open [-s|-t|-b|-p PROMPT|--session ID] BRANCH [BASE]`: the
  branch's worktree. If there is none, it is made where the repository's
  layout puts it: a local branch as it is, a branch only on `origin` tracking
  it, else a new branch from `BASE` (default `worktrees.base`). The seed files
  are copied into a new worktree. Then: with no option it prints the path, for
  the caller to go there (`--cwd-file FILE` writes it to a file for a shell
  function to `cd`); `-s` prints it and stays; `-t` goes to the worktree's tab,
  opening one; `-b` opens the tab in the background; `-p` and `--session` open
  a background tab whose agent starts on the prompt or the conversation (and
  fail if it already has a tab). Outside a multiplexer, `-t` goes there
  instead, `-b` stays, and `-p` fails.
- `ade worktree rm [-f] NAME`: removes the worktree of a branch, folder name or
  path (`-f`: even with uncommitted changes) and closes its tabs, except yours
  and except when an agent runs it.
- `ade worktree prune [-y] [-n] [-m]`: removes the worktrees whose remote
  branch was deleted (`-m`: also those merged through a GitHub PR, matched by
  the branch's exact last commit), never the one you are in or the default
  branch's. It fetches first (`-n`: doesn't), lists them and asks (`-y`:
  doesn't), and closes their tabs as `rm` does.
- `ade worktree ls [--json]`: lists the worktrees; `--json` gives each one's
  branch, number of changed files, commits ahead of and behind
  `worktrees.base`, and whether it has a tab.
- `ade worktree clone URL [DIR]`: clones a repository laid out for the
  configured layout.
- `ade worktree convert [-y]`: turns the normal clone you are in into the
  configured layout, after showing what will change and asking (`-y`:
  doesn't). With `bare`, the clone's other worktrees stay where they are and
  keep working; with `sibling` or `inside`, they move where the layout puts
  them.

A worktree's tab is a tab whose panes are all inside the worktree, whatever
its name.

Layouts (`worktrees.layout`):

- `bare` (default): a bare repository in `project/.bare`, each branch's
  worktree in `project/<branch>` (`/` becomes `-`). In a normal clone,
  worktrees go inside it.
- `sibling`: beside a normal clone, `repo.<branch>`.
- `inside`: in `repo/.worktrees/<branch>`, kept out of `git status`.
- A file of your own: `"layout": "~/.config/ade/my-layout.ts"`, exporting
  `(kit) => ({ ...kit.builtin.layout("sibling"), name: "mine", path: (repo, name) => ... })`.
  It can have its own `clone` and `convert` too, with `kit.git` and
  `kit.fail` (as `src/layouts/bare.ts` does), so it needs no fork.

A repository keeps its layout when the config changes: ade records it in the
repository's git config (`ade.layout`) when it clones or converts it or makes
its first worktree there, and before that goes by where its worktrees are.

Seeds, the untracked files copied into new worktrees: `ADE_SEED_FILE` (a
manifest, one path or glob per line), else the repository's
`<common-dir>/ade-seed`, else `ADE_SEED` (newline-separated), else
`worktrees.seed`.

## Config

`$XDG_CONFIG_HOME/ade/config.json` (`~/.config/ade/config.json`), plain JSON,
optional, read on every call. Objects merge into the defaults key by key.

```json
{
  "multiplexer": "zellij",
  "editor": "helix",
  "agent": "opencode",
  "reviewer": "tuicr",
  "review": { "deliver": "insert" },
  "worktrees": { "layout": "bare", "base": "origin/HEAD", "seed": [".env", ".env.*", ".envrc", "pyrightconfig.json"] },
  "zellij": {
    "layout": "dev",
    "panes": { "agent": "opencode", "shell": "main", "editor": "editor", "review": "review" },
    "newPanes": { "agent": "right" },
    "tabName": "{worktree}"
  },
  "opencode": { "command": ["opencode"] }
}
```

- The four choices take a built-in name or a path to a module of your own;
  `"multiplexer": "none"` works without one (`open` then needs an editor with
  its own remote control, and there are no tabs).
- `review.deliver`: `"insert"` fills in the agent's prompt for you to send,
  `"submit"` sends the comments.
- Each adapter reads its own section. `zellij`: the layout new tabs open with;
  the pane names that give panes their roles; `newPanes`, where a new pane of
  a role opens, beside the pane that has focus (`right`, `down`, `left`, `up`;
  `null`: where Zellij puts it, which for the editor means above the shell
  pane, as the layout's swap layout does); and the tab name, where `{project}`
  and `{worktree}` are the repository's and the worktree's folder names.
  `opencode`: the command that starts it.

## Adapters

An adapter is a module whose default export gets the kit and returns the
adapter: `export default (kit) => ({ api: 1, name: "...", ... })`. The loader
refuses one written for another `api`, or missing a required operation, and
says what is missing. The interfaces are in `src/types.ts` (import them with
`import type`, which Node strips, so nothing has to resolve at run time). The
kit gives adapters what they need without imports: `run`, quoting, keys, the
config and their options (`kit.options("mine", defaults)`), git (`kit.git`)
and the error that ends a command (`kit.fail`), the helpers `typedEditor` (an
editor reached by typing into its pane) and `pasteAgent`, and the built-ins to
start from (`kit.builtin.multiplexer("zellij")` and the like: wrap one and
change only what you need). An adapter of your own lives outside the
repository and is named in the config by its path, so most changes need no
fork.

Programs are reached through the worktree: an editor or agent without its own
remote control through its pane in the worktree's tab (so it needs a
multiplexer), one with remote control under a name derived from the worktree
path (`workspace.session`).

## Code

| File | |
| --- | --- |
| `src/index.ts` | the public surface; everything else is internal |
| `src/cli.ts` | the `ade` command, a thin layer over the actions |
| `src/actions.ts` | open, send, review, workspace, tabs, closeTabs |
| `src/worktrees.ts`, `src/worktree-cli.ts`, `src/git.ts` | the worktree commands, and running git |
| `src/config.ts`, `src/load.ts`, `src/builtins.ts`, `src/kit.ts` | the config, loading adapters, the built-ins, what adapters get |
| `src/workspace.ts`, `src/multiplexer.ts` | where the caller is; pane logic for every multiplexer |
| `src/editor.ts`, `src/agent.ts`, `src/review.ts` | the helpers, and what a review covers |
| `src/multiplexers/`, `src/editors/`, `src/agents/`, `src/reviewers/`, `src/layouts/` | the built-in adapters |

Only TypeScript that Node can strip (no `enum`, `namespace` or parameter
properties); relative imports end in `.ts`; types come in with `import type`.

Tests: `node --test test/*.test.ts` (Node's test runner, no dependencies).
