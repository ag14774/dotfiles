# opencode-ade

An OpenCode plugin that lets agents act in the terminal tab where you talk to
them, through [ade-kit](../ade-kit):

- `show_file` opens files in the tab's editor (as `ade open` does), also after
  `/cd`.
- `delegate` starts work in another worktree: it makes (or reuses) the
  worktree for a branch, opens a background tab for it, and that tab's
  OpenCode starts on a brief the agent writes. Say "delegate this", "do this in
  a new worktree", or use `/delegate [what]`. "With the context" (or "with a
  summary") first copies the conversation into the new worktree (compacting
  the copy), so the new tab continues it; the original stays where it is. The
  calling conversation isn't told when the new one finishes.
- `status` answers "how are the other worktrees doing?": each worktree's
  branch, uncommitted changes, commits ahead of the base, whether it has a tab,
  and its latest conversation (working, waiting for you, idle, failed or
  interrupted) with the start of its last answer. Read-only.

`delegate` and `status` work on the repository of the conversation's folder;
for another one the agent passes a folder in it as `directory`. OpenCode's own
`worktree_create` and `worktree_list` tools are hidden from agents (they make
worktrees without a tab).

It needs OpenCode 2.2.5 or newer, ade-kit beside it (the repository's npm
workspaces), and OpenCode running in a pane of the configured multiplexer.

## How it works

An agent's commands run in OpenCode's shared background service, not in your
pane, so the service doesn't know which tab is yours. The plugin has two
parts:

- The server part (`src/server.ts`, in the service) defines the tools. A tool
  call becomes a request to the OpenCode apps; it waits for one to claim it,
  and tells the agent what happened, including "no OpenCode pane in a
  multiplexer is showing this conversation". It also removes the Zellij
  variables from the service's own environment: a conversation no pane shows
  would otherwise act on the tab of whichever pane started the service.
- The app part (`src/tui.ts`, in each OpenCode app) claims the requests for
  the conversation its pane shows (a subagent's go to its parent's pane) and
  carries them out with ade-kit, in-process, with that pane's environment. It
  also gives each conversation it shows short instructions about this setup
  (tabs, `show_file`, `status`, delegating only when asked) as a
  per-conversation instruction entry, so OpenCode elsewhere never sees them.

`src/rpc.ts` holds the calls between the two. Its `show_file`, `delegate` and
`status` methods do what the tools do, for scripts:

```sh
opencode api POST "/api/rpc/ade/show_file?location%5Bdirectory%5D=DIR" \
  -d '{"input":{"sessionID":"ses_…","paths":["/abs/file"]}}'
```

(RPC calls take their folder from `location[directory]`.)

## Installing

Link the package folder as `~/.config/opencode/plugins/ade`; OpenCode loads
both parts from there. The service keeps the server part it loaded until
`opencode service restart` (which interrupts running conversations); OpenCode
reloads a changed package plugin, but not after a reload that fails. When the
files differ from what the service runs, the OpenCode apps show a warning. An
app loads the app part when it starts.

## Tests

`node --test test/*.test.ts`. The dotfiles' `tests/ade_plugin_smoke.zsh` runs
it with a private OpenCode service and a throwaway Zellij session (nine short
model calls).
