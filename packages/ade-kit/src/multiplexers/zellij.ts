// Zellij (0.45): panes and tabs from `list-panes --json` and `list-tabs
// --json`, roles from pane names (the `zellij.panes` options), agent marks as
// icons in front of tab names, totals through `zellij pipe` to zjstatus. Every
// call names its session: given a session name that no longer exists, plain
// `zellij action` acts on whichever session is running.
import { URGENCY } from "../multiplexer.ts"
import type { Kit, Mark, MultiplexerAdapter, Pane, Role, ShownMark, Tab } from "../types.ts"

// Nerd Font: bell, times-circle, check, timer-sand.
export const ICONS: Record<ShownMark, string> = {
  waiting: "\u{F0F3}",
  failed: "\u{F057}",
  done: "\u{F00C}",
  working: "\u{F051F}",
}
// Catppuccin Mocha: peach, red, green, yellow.
export const COLOURS: Record<ShownMark, string> = {
  waiting: "#fab387",
  failed: "#f38ba8",
  done: "#a6e3a1",
  working: "#f9e2af",
}

export const markOf = (name: string): Mark => URGENCY.find((mark) => name.startsWith(`${ICONS[mark]} `)) ?? "none"
export const baseName = (name: string) => (markOf(name) === "none" ? name : name.slice(name.indexOf(" ") + 1))
export const withMark = (name: string, mark: Mark) => (mark === "none" ? baseName(name) : `${ICONS[mark]} ${baseName(name)}`)

// zjstatus text (its #[...] colour syntax) for the number of tabs with each
// mark, e.g. "<bell> 1  <timer-sand> 2"; empty when no tab has one.
export const totalsText = (counts: Partial<Record<ShownMark, number>>) =>
  URGENCY.filter((mark) => (counts[mark] ?? 0) > 0)
    .map((mark) => `#[fg=${COLOURS[mark]}]${ICONS[mark]} ${counts[mark]}`)
    .join("  ")

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
    const zellij = async (...args: string[]) => {
      const result = await kit.run(["zellij", "--session", where.session, ...args])
      if (!result.ok) throw new Error(`zellij ${args.slice(0, 2).join(" ")}: ${result.stderr.trim()}`)
      return result.stdout
    }
    const action = (...args: string[]) => zellij("action", ...args)
    const tabs = async () => parseTabs(await action("list-tabs", "--json"))
    return {
      panes: async () => parsePanes(await action("list-panes", "--json"), options.panes),
      tabs,
      markTab: async (tab, mark) => {
        const current = (await tabs()).find((t) => t.id === tab)
        if (!current) return
        const name = withMark(current.name, mark)
        if (name !== current.name) await action("rename-tab-by-id", tab, name)
      },
      marks: async () => new Map((await tabs()).map((tab) => [tab.id, markOf(tab.name)])),
      // To every zjstatus in the session (a blank message would make `zellij
      // pipe` read stdin).
      showTotals: async (counts) => {
        await zellij("pipe", "--", `${options.totals}::${totalsText(counts) || " "}`)
      },
    }
  },
})
