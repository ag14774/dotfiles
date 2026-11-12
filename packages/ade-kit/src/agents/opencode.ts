// OpenCode, reached through its pane: its app has no way to take text from
// outside yet (2.2.5 handles a `tui.prompt.append` event, but nothing outside
// the app can send it), so text is pasted. OpenCode shows a paste of 3 lines
// or more, or 150 characters or more, as "[Pasted ~N lines]" and sends its
// text. Options: "opencode": { "command": [...] } starts it (default:
// opencode; the dotfiles use opencode-pane).
import type { Agent, Kit } from "../types.ts"

export default (kit: Kit) => {
  const options = kit.config.opencode as { command?: unknown } | undefined
  const command = options?.command ?? ["opencode"]
  if (!Array.isArray(command) || !command.length || command.some((word) => typeof word !== "string"))
    throw new Error("ade: opencode.command must be a list of strings")
  return {
    ...kit.pasteAgent({
      name: "opencode",
      label: "OpenCode",
      start: (o) => [
        ...(command as string[]),
        ...(o.session ? ["--session", o.session] : []),
        ...(o.prompt ? ["--prompt", o.prompt] : []),
      ],
    }),
    // OpenCode marks the commands its agents run.
    ranByAgent: (env) => Boolean(env.OPENCODE_TERMINAL),
  } satisfies Agent
}
