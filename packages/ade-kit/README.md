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
| `ade open FILE[:LINE[:COLUMN]]...` | Open files in the editor pane of the caller's tab, starting the editor if needed. Never switches you to another tab: in a tab you are not on, it only uses an editor that is already there. Refuses when the caller's pane no longer exists. |
| `ade send FILE [START [END [LANGUAGE]]] [< SELECTION]` | Paste a reference (`FILE:START-END`) and the selection, as a fenced block, into the tab's agent prompt and focus it. Nothing is submitted. |
| `ade send --text [--submit] < TEXT` | Paste text as it is; `--submit` also sends it. |
| `ade review` | Review the worktree of the pane you were in with the reviewer, in the terminal it runs in (a key can start it in a floating pane), then give the agent your comments (`review.deliver`). One review per tab: a second one shows the open review. |
| `ade review --scope` | What a review here covers: `-r BASE..HEAD` for the commits since `worktrees.base`, `-w` for uncommitted changes. |
| `ade restart-agent [DIR]` | Start the tab's agent afresh in `DIR` (default: here), in place of its agent pane; focus stays where it is. |
| `ade where` | The folder of the pane you were in (a key's floating pane starts in the session's folder). |
| `ade worktree COMMAND` | `clone`, `open`, `rm`, `ls [--json]`, `prune`, `convert`: below. |

Set `ADE_LOG=FILE` to append each command `ade` runs to a file, and
`ADE_CONFIG=/abs/path.json` to read another config.

## Worktrees

`ade worktree open BRANCH [BASE]` makes or reuses the branch's worktree (a
local branch as it is, one only on `origin` tracking it, else a new branch
from `BASE` or `worktrees.base`), copies the seed files into a new one, and
prints its path. `-t` goes to its tab (opening one with the layout), `-b`
opens the tab in the background, `-p PROMPT` / `--session ID` start the agent
there. Outside a multiplexer `-t` and `-b` fall back to changing directory and
staying; `-p` fails. With `--cwd-file FILE`, the folder to change to is written
to `FILE`, for a shell function that `cd`s.

`rm` removes a worktree (by branch, folder name or path) and closes its tabs,
except yours; `prune` removes those whose remote branch was deleted (`-m`: also
those merged through a GitHub PR, matched by the exact head commit); `ls
--json` reports each worktree's branch, changes, commits ahead and behind
`worktrees.base`, and whether it has a tab. `clone` and `convert` set up a
repository for the configured layout.

Layouts (`worktrees.layout`):

- `bare` (default): a bare repository in `project/.bare`, each branch's
  worktree in `project/<branch>` (`/` becomes `-`). In a normal clone,
  worktrees go inside it.
- `sibling`: beside a normal clone, `repo.<branch>`.
- `inside`: in `repo/.worktrees/<branch>`, kept out of `git status`.
- A file of your own: `"layout": "~/.config/ade/my-layout.ts"`, exporting
  `(kit) => ({ ...kit.builtin.layout("sibling"), name: "mine", path: (repo, name) => ... })`.

A repository keeps its layout when the config changes: ade records it in the
repository's git config (`ade.layout`) when it clones or converts it or makes
its first worktree there, and before that goes by where its worktrees are.
`convert` turns a normal clone into the configured layout (`bare`: the clone's
other worktrees stay and keep working; `sibling`, `inside`: its worktrees move).

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
- Each adapter reads its own section: `zellij` (the layout new tabs open with,
  the pane names that give panes their roles, and the tab name, where
  `{project}` and `{worktree}` are the repository's and the worktree's folder
  names), `opencode` (the command that starts it).

## Adapters

An adapter is a module whose default export gets the kit and returns the
adapter: `export default (kit) => ({ api: 1, name: "...", ... })`. The loader
refuses one written for another `api`, or missing a required operation, and
says what is missing. The interfaces are in `src/types.ts` (import them with
`import type`, which Node strips, so nothing has to resolve at run time). The
kit gives adapters what they need without imports: `run`, quoting, keys, the
config and their options (`kit.options("mine", defaults)`), the helpers
`typedEditor` (an editor reached by typing into its pane) and `pasteAgent`, and
the built-ins to start from.

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
| `src/worktrees.ts`, `src/worktree-cli.ts` | the worktree commands |
| `src/config.ts`, `src/load.ts`, `src/builtins.ts`, `src/kit.ts` | the config, loading adapters, the built-ins, what adapters get |
| `src/workspace.ts`, `src/multiplexer.ts` | where the caller is; pane logic for every multiplexer |
| `src/editor.ts`, `src/agent.ts`, `src/review.ts` | the helpers, and what a review covers |
| `src/multiplexers/`, `src/editors/`, `src/agents/`, `src/reviewers/`, `src/layouts/` | the built-in adapters |

Only TypeScript that Node can strip (no `enum`, `namespace` or parameter
properties); relative imports end in `.ts`; types come in with `import type`.

Tests: `node --test test/*.test.ts` (Node's test runner, no dependencies).
