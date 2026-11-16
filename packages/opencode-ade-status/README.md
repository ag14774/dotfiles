# opencode-ade-status

An OpenCode plugin (app part only) with two jobs:

- **Done and failed statuses.** OpenCode reports to its terminal what its
  conversations are doing, with OSC 7501: working, or waiting for you (a
  permission request or a question). It doesn't report how the work ended
  (OpenCode issue #60411); this plugin adds "done" or "error" when its pane's
  conversations go idle. Zellij 0.46 tracks each pane's status from these
  reports and shows done and failed only for a pane that wasn't in view when
  the work ended, until you have seen it; a bar such as
  [ade-zjstatus](https://github.com/ag14774/ade-zjstatus) draws them on the
  tabs. Any terminal that understands OSC 7501 can use them.
- **Attention sounds once.** OpenCode's built-in attention plugin
  (`opencode.notifications`) plays a sound, and shows a system notification,
  for every conversation's events in every OpenCode app connected to the
  service: with an app in each tab, once per tab. With the built-in plugin
  off (`"-opencode.notifications"` in `cli.json`'s `plugins`), this plugin
  plays the same sounds through the same `attention.notify`, with the same
  volume and focus rules (`attention.*` in `cli.json`), only in the app showing
  the conversation (and for its subagents). It reads `cli.json` as OpenCode
  does and plays nothing while the built-in plugin is on, so the two never
  both play; `"opencode.notifications"` in `plugins` brings the built-in back.

It needs OpenCode 2.2.5 or newer and nothing else (not ade-kit).

## Installing

Link the package folder as `~/.config/opencode/plugins/ade-status`. Each
OpenCode app loads it when it starts, so restart the apps after a change.

## Tests

`node --test test/*.test.ts`. The dotfiles' `tests/opencode_attention_smoke.zsh`
checks the sounds with a private OpenCode service, and
`tests/ade_plugin_smoke.zsh` the statuses.
