# AGENTS.md

For people and coding agents changing this repository, and for forks. What
the setup does and how to use it: [README.md](README.md). What changed between
versions: [CHANGELOG.md](CHANGELOG.md).

## What is where

A terminal-only agentic development environment: Zellij, Helix, OpenCode,
Yazi, tuicr and zsh, glued together by the packages in `packages/`.

- `packages/` (npm workspaces), each with its own README:
  - `ade-kit`: the `ade` command and library. Adapters for the multiplexer,
    editor, agent, reviewer and worktree layout (`src/multiplexers/`,
    `src/editors/`, `src/agents/`, `src/reviewers/`, `src/layouts/`, listed
    in `src/builtins.ts`); the worktree commands (`src/worktrees.ts`); the
    interfaces (`src/types.ts`); the public surface (`src/index.ts`).
  - `opencode-ade`, `opencode-ade-status`, `opencode-ade-worktrees`: the
    OpenCode plugins, linked from `config/.config/opencode/plugins/`.
- `config/`: stowed into `$HOME` (Zellij, Helix, Yazi, OpenCode, the ADE
  config, `config/.local/bin/`).
- `shell/*.zsh`: the zsh setup; the `wt*` functions are short names for
  `ade worktree`.
- `install.sh`, `install/`: the installer.
- `tests/`: zsh and python tests; `tests/lib/zellij-sandbox.zsh` for the live
  ones. Each package's node tests are in its `test/`.

## Where changes belong

Keep a fork small: most changes need no edit to the packages.

- Settings go in `~/.config/ade/config.json` (`ADE_CONFIG` names another
  file). It is merged key by key over the defaults; ade-kit's README lists
  the keys.
- Behaviour goes in an adapter file of your own, outside the repository,
  named in the config by its path (`"editor": "~/ade/my-editor.ts"`). Its
  kit gives it what it needs without imports:
  - `kit.builtin.multiplexer("zellij")` (also `editor`, `agent`,
    `reviewer`, `layout`): wrap a built-in and change only what you need;
  - `kit.options("mine", defaults)`: your own config section;
  - `kit.git` to run and parse git, `kit.fail(message)` to end a command
    with a message, `kit.run` for other programs.
- Change a package only for something an adapter can't do, and say why in
  the commit.

## Code conventions

- TypeScript that Node can strip: no `enum`, `namespace` or parameter
  properties. Relative imports end in `.ts`; types come in with
  `import type`.
- ade-kit uses only Node's built-in modules.
- Plugins import only `"ade-kit"` (its `src/index.ts`), never its other
  files. If a plugin needs more, export it from `index.ts`.
- An adapter is `export default (kit) => adapter`, with `api: 1`.
- Comments are sparse and say what the code does and why, never its history
  ("used to", "no longer", "since the move to"). History goes in commit
  messages and CHANGELOG.md.
- Messages name the command the user ran (`ade worktree rm: …`).
- Small commits, each one working.

## Format, check, test

```sh
npm install      # links the workspaces; dev dependencies for the check
npm run format   # Prettier for TypeScript, shfmt for the bash scripts
npm run check    # tsc, strict, no output files
npm test         # every test that needs no Zellij session, service or model
```

`.editorconfig` covers the other files. After a change, also run the live
test the README's "Tests" table names for it. A change to user-visible
behaviour gets an entry in CHANGELOG.md; the README and comments describe only
how things are now.

## Live tests: safety rules

Live tests start real Zellij and OpenCode processes. They must never reach
the user's own session or service.

- Run them only through `tests/lib/zellij-sandbox.zsh`: its own Zellij
  socket folder, `HOME` and OpenCode service. Its guards refuse otherwise.
- Never run a `zellij` command that could reach the user's session. Outside
  the sandbox, run anything that may ask Zellij (`ade where`,
  `ade worktree ls --json`) with
  `env -u ZELLIJ -u ZELLIJ_SESSION_NAME -u ZELLIJ_PANE_ID`.
- Never use the session name `main`: it is the user's session.
- Never start, stop or restart the user's OpenCode service
  (`opencode service …`); tests use a private one on its own port.
