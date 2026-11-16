// OpenCode, reached through its pane: its app has no way to take text from
// outside yet (2.2.5 handles a `tui.prompt.append` event, but nothing outside
// the app can send it), so text is pasted. OpenCode shows a paste of 3 lines
// or more, or 150 characters or more, as "[Pasted ~N lines]" and sends its
// text. Options: "opencode": { "command": [...] } starts it (default:
// opencode).
//
// Its shared service keeps a location for every folder it served, also once
// the folder is gone, and its reload (`opencode reload`) then fails with
// "Directory not found" (2.2.5). forgetGone evicts those locations through
// the service's API, asking only a running service: `opencode api` would
// start one.
import { statSync } from "node:fs"
import type { Agent, Kit } from "../types.ts"

const LOCATIONS = "/api/debug/location"

const isDirectory = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
const firstLine = (text: string) => text.trim().split("\n")[0]

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
    forgetGone: async (env) => {
      const opencode = (args: string[]) => kit.run(["opencode", ...args], { env })
      const status = await opencode(["service", "status"])
      if (!status.ok || !/^https?:\/\//.test(status.stdout.trim())) return []
      const listed = await opencode(["api", "get", LOCATIONS])
      let locations: unknown
      try {
        locations = JSON.parse(listed.stdout)
      } catch {
        // not a list: said below
      }
      if (!listed.ok || !Array.isArray(locations))
        throw new Error(`could not list OpenCode's locations: ${firstLine(listed.stderr || listed.stdout)}`)
      const gone = (locations as { directory?: unknown }[])
        .map((location) => location?.directory)
        .filter((dir): dir is string => typeof dir === "string" && !isDirectory(dir))
      for (const dir of gone) {
        const evicted = await opencode([
          "api",
          "delete",
          `${LOCATIONS}?location%5Bdirectory%5D=${encodeURIComponent(dir)}`,
        ])
        if (!evicted.ok)
          throw new Error(`OpenCode could not let go of ${dir}: ${firstLine(evicted.stderr || evicted.stdout)}`)
      }
      return gone
    },
  } satisfies Agent
}
