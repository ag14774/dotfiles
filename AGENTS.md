# AGENTS.md

For people and coding agents changing these dotfiles, and for forks. What the
setup does and how to use it: [README.md](README.md). What changed between
versions: [CHANGELOG.md](CHANGELOG.md).

## What is where

A terminal-only agentic development environment: Zellij, Helix, OpenCode,
Yazi, tuicr and zsh, glued together with
[ade](https://github.com/ag14774/ade).

- `config/`: stowed into `$HOME` (Zellij, Helix, Yazi, tuicr, OpenCode, the
  ADE config, `config/.local/bin/`).
- `shell/*.zsh`: the zsh setup. The `wt*` functions and `ocreload` come from
  ade's starter (`$ADE_HOME/starter/shell/ade.zsh`).
- `install.sh`, `install/`: the installer. It keeps ade in
  `~/.local/share/ade` at `ADE_REF`, or links your own checkout (`ADE_HOME`).
- `tests/`: zsh and python tests.

## Where changes belong

- The `ade` command, the OpenCode plugins, the `wt*` functions, `ocreload`,
  and anything a user of ade without these dotfiles would want: in
  [ade](https://github.com/ag14774/ade) (its AGENTS.md has its conventions).
  Then bump `ADE_REF` in `install.sh`, with a CHANGELOG entry.
- ade's settings for this setup: `config/.config/ade/config.json`, or an
  adapter file named in it by path, before changing ade itself.
- Personal setup (keys, theme, tools): `config/`, `shell/`, `install/`.

## Conventions

- Comments are sparse and say what the code does and why, never its history
  ("used to", "no longer"). History goes in commit messages and
  CHANGELOG.md; the README describes only how things are now.
- A change to user-visible behaviour gets a CHANGELOG entry: what changes and
  what to do after pulling.
- Small commits, each one working.
- `npm run format` (shfmt) for the shell scripts; `.editorconfig` for the rest.

## Tests

`npm test` runs every test that needs no Zellij session, service or model.
After a change, also run the live test the README's "Tests" table names for
it. The live tests use ade's sandbox, so they need ade installed (`ADE_HOME`
or `~/.local/share/ade`).

## Live tests: safety rules

Live tests start real Zellij and OpenCode processes. They must never reach
the user's own session or service.

- Run them only through ade's `tests/lib/zellij-sandbox.zsh`: its own Zellij
  socket folder, `HOME` and OpenCode service. Its guards refuse otherwise.
- Never run a `zellij` command that could reach the user's session. Outside
  the sandbox, run anything that may ask Zellij (`ade where`,
  `ade worktree ls --json`) with
  `env -u ZELLIJ -u ZELLIJ_SESSION_NAME -u ZELLIJ_PANE_ID`.
- Never use the session name `main`: it is the user's session.
- Never start, stop or restart the user's OpenCode service
  (`opencode service …`); tests use a private one on its own port.
