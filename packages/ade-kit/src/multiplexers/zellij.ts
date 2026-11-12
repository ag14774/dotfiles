// Zellij (0.46): panes and tabs from `list-panes --json` and `list-tabs
// --json`, roles from pane names (the `zellij.panes` options). Every call
// names its session: given a session name that no longer exists, plain
// `zellij action` acts on whichever session is running.
import type { Kit, MultiplexerAdapter, Pane, Role, Tab } from "../types.ts"

type RawPane = {
  id: number
  is_plugin: boolean
  tab_id: number
  title: string
  pane_cwd: string | null
  exited: boolean
  is_held: boolean
  is_floating: boolean
  is_focused: boolean
}
type RawTab = { tab_id: number; name: string; active: boolean }

// Terminal panes only: plugin panes (the bars) have IDs of their own, which
// can equal a terminal pane's.
export function parsePanes(json: string, names: Record<Role, string>): Pane[] {
  const roles = Object.entries(names) as [Role, string][]
  return (JSON.parse(json) as RawPane[])
    .filter((pane) => !pane.is_plugin)
    .map((pane) => {
      const role = roles.find(([, name]) => name === pane.title)?.[0]
      return {
        id: String(pane.id),
        tab: String(pane.tab_id),
        ...(role ? { role } : {}),
        ...(pane.pane_cwd ? { cwd: pane.pane_cwd } : {}),
        running: !(pane.exited || pane.is_held),
        floating: Boolean(pane.is_floating),
        focused: Boolean(pane.is_focused),
      }
    })
}

export const parseTabs = (json: string): Tab[] =>
  (JSON.parse(json) as RawTab[]).map((tab) => ({ id: String(tab.tab_id), name: String(tab.name), active: Boolean(tab.active) }))

export default (kit: Kit): MultiplexerAdapter => ({
  api: 1,
  name: "zellij",
  here: (env) =>
    env.ZELLIJ && env.ZELLIJ_SESSION_NAME && env.ZELLIJ_PANE_ID
      ? { session: env.ZELLIJ_SESSION_NAME, pane: env.ZELLIJ_PANE_ID }
      : undefined,
  connect: (where) => {
    const options = kit.config.zellij
    const action = async (...args: string[]) => {
      const result = await kit.run(["zellij", "--session", where.session, "action", ...args])
      if (!result.ok) throw new Error(`zellij action ${args[0]}: ${result.stderr.trim()}`)
      return result.stdout
    }
    return {
      panes: async () => parsePanes(await action("list-panes", "--json"), options.panes),
      tabs: async () => parseTabs(await action("list-tabs", "--json")),
    }
  },
})
