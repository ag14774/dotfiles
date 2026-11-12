// Zellij (0.46): panes and tabs from `list-panes --json` and `list-tabs
// --json`, roles from pane names (the `zellij.panes` options). Every call
// names its session: given a session name that no longer exists, plain
// `zellij action` acts on whichever session is running.
import type { Key, Kit, MultiplexerAdapter, Pane, Role, Tab } from "../types.ts"

type RawPane = {
  id: number
  is_plugin: boolean
  tab_id: number
  title: string
  pane_cwd: string | null
  pane_y?: number
  exited: boolean
  is_held: boolean
  is_floating: boolean
  is_focused: boolean
}
type RawTab = { tab_id: number; name: string; active: boolean }

// Terminal panes only: plugin panes (the bars) have IDs of their own, which
// can equal a terminal pane's.
const terminal = (json: string) => (JSON.parse(json) as RawPane[]).filter((pane) => !pane.is_plugin)

export function parsePanes(json: string, names: Record<Role, string>): Pane[] {
  const roles = Object.entries(names) as [Role, string][]
  return terminal(json).map((pane) => {
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

const SETTLE_MS = 150 // for a swap layout to apply
const APPEAR_MS = 10_000 // for a new pane to be listed
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

export default (kit: Kit): MultiplexerAdapter => ({
  api: 1,
  name: "zellij",
  label: "Zellij",
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
    const id = (pane: string) => `terminal_${pane}`
    const listed = async () => terminal(await action("list-panes", "--json"))
    // Zellij 0.46 refuses to focus the pane that has focus.
    const focusPane = async (pane: string) => {
      await action("focus-pane-id", id(pane)).catch((error: Error) => {
        if (!/is already focused/.test(error.message)) throw error
      })
    }

    // `new-pane` prints the new pane's ID; else, the first pane with the name
    // in the tab, once it is listed.
    const paneStarted = async (output: string, tab: string, name: string) => {
      const printed = /terminal_(\d+)/.exec(output)?.[1]
      if (printed) return printed
      for (const deadline = Date.now() + APPEAR_MS; Date.now() < deadline; await sleep(50)) {
        const pane = (await listed()).find((p) => String(p.tab_id) === tab && p.title === name)
        if (pane) return String(pane.id)
      }
      throw new Error(`the ${name} pane did not appear`)
    }

    // The layout's swap layout (dev.kdl's `with-editor`) puts the editor above
    // the shell pane. Zellij applies it by itself only while nobody has
    // rearranged the tab (after `ocreload`, the editor lands in a flat row),
    // and since 0.46 it keeps the panes' order, so the editor can land below
    // the shell pane. Only then: apply the swap layout again, and if that
    // doesn't help, move the editor up. A tab that is already right is left
    // alone (applying the swap layout again would cycle away from it).
    const placeEditor = async (tab: string, editor: string) => {
      const rows = async () => {
        const panes = (await listed()).filter((p) => String(p.tab_id) === tab)
        const above = panes.find((p) => String(p.id) === editor)?.pane_y
        const below = panes.find((p) => p.title === options.panes.shell)?.pane_y
        return above === undefined || below === undefined ? undefined : above - below
      }
      await sleep(SETTLE_MS)
      if (((await rows()) ?? -1) < 0) return
      await action("next-swap-layout")
      await sleep(SETTLE_MS)
      if (((await rows()) ?? 0) > 0) await action("move-pane", "--pane-id", id(editor), "up")
    }

    const type = async (pane: string, keys: Key[]) => {
      for (const key of keys)
        if ("text" in key) await action("write-chars", "--pane-id", id(pane), key.text)
        else await action("write", "--pane-id", id(pane), key.key === "escape" ? "27" : "13")
    }

    return {
      panes: async () => parsePanes(await action("list-panes", "--json"), options.panes),
      tabs: async () => parseTabs(await action("list-tabs", "--json")),
      // The pane closes when its program ends, instead of waiting for Enter.
      start: async ({ tab, role, argv, focus, replace }) => {
        const name = options.panes[role]
        if (replace !== undefined) {
          const unfocused = focus ? [] : ["--no-focus"]
          const output = await action(
            "new-pane", "--in-place", "--pane-id", id(replace), "--close-replaced-pane", "--close-on-exit",
            ...unfocused, "-n", name, "--", ...argv,
          )
          return paneStarted(output, tab, name)
        }
        if (!focus) throw new Error(`a new ${name} pane can only open in the tab you are on`)
        // New panes and swap layouts apply to the tab in front: show this one
        // first (it usually is in front already).
        await action("go-to-tab-by-id", tab)
        const pane = await paneStarted(await action("new-pane", "--close-on-exit", "-n", name, "--", ...argv), tab, name)
        if (role === "editor") await placeEditor(tab, pane).catch(() => {})
        await focusPane(pane)
        return pane
      },
      type,
      focus: focusPane,
    }
  },
})
