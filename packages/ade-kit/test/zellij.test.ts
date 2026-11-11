import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DEFAULTS } from "../src/config.ts"
import zellij, {
  baseName,
  COLOURS,
  ICONS,
  markOf,
  parsePanes,
  parseTabs,
  totalsText,
  withMark,
} from "../src/multiplexers/zellij.ts"
import type { Kit, RunResult } from "../src/types.ts"

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8")

test("list-panes --json: terminal panes with their roles, directories and states", () => {
  assert.deepEqual(parsePanes(fixture("zellij-list-panes.json"), DEFAULTS.zellij.panes), [
    { id: "0", tab: "0", role: "shell", cwd: "/work/A", running: true, floating: false, focused: false },
    { id: "1", tab: "0", role: "agent", cwd: "/work/A", running: true, floating: false, focused: false },
    { id: "2", tab: "0", role: "editor", cwd: "/work/A", running: true, floating: false, focused: false },
    { id: "3", tab: "0", running: false, floating: false, focused: true },
    { id: "4", tab: "0", role: "review", cwd: "/work/B", running: true, floating: true, focused: true },
    { id: "5", tab: "1", role: "shell", cwd: "/work/B", running: true, floating: false, focused: true },
  ])
})

test("roles follow the configured pane names", () => {
  const names = { agent: "claude", shell: "editor", editor: "hx", review: "review" }
  const roles = parsePanes(fixture("zellij-list-panes.json"), names).map((pane) => pane.role ?? "-")
  assert.deepEqual(roles, ["-", "-", "shell", "-", "review", "-"])
})

test("list-tabs --json: IDs, names and which tab is active", () => {
  assert.deepEqual(parseTabs(fixture("zellij-list-tabs.json")), [
    { id: "0", name: "A", active: false },
    { id: "1", name: "\u{F051F} B", active: true },
  ])
})

test("here: inside Zellij only with its session and pane", () => {
  const adapter = zellij({ config: DEFAULTS, run: async () => ({ ok: true, stdout: "", stderr: "" }) })
  const env = { ZELLIJ: "0", ZELLIJ_SESSION_NAME: "main", ZELLIJ_PANE_ID: "7" }
  assert.deepEqual(adapter.here(env), { session: "main", pane: "7" })
  for (const name of Object.keys(env)) assert.equal(adapter.here({ ...env, [name]: undefined }), undefined)
  assert.equal(adapter.here({ ...env, ZELLIJ_PANE_ID: "" }), undefined)
})

test("the marks: Nerd Font icons and Catppuccin colours, byte for byte", () => {
  const codes = Object.fromEntries(Object.entries(ICONS).map(([mark, icon]) => [mark, [...icon].map((c) => c.codePointAt(0))]))
  assert.deepEqual(codes, { waiting: [0xf0f3], failed: [0xf057], done: [0xf00c], working: [0xf051f] })
  assert.deepEqual(COLOURS, { waiting: "#fab387", failed: "#f38ba8", done: "#a6e3a1", working: "#f9e2af" })
})

test("a mark goes in front of the tab name, replacing any other", () => {
  assert.equal(withMark("feat", "working"), "\u{F051F} feat")
  assert.equal(withMark("\u{F051F} feat", "done"), "\u{F00C} feat")
  assert.equal(withMark("\u{F00C} feat", "none"), "feat")
  assert.equal(withMark("feat", "none"), "feat")
  assert.equal(withMark("\u{F0F3} two words", "failed"), "\u{F057} two words")
  assert.equal(markOf("\u{F0F3} feat"), "waiting")
  assert.equal(markOf("\u{F0F3}feat"), "none")
  assert.equal(markOf("feat \u{F0F3}"), "none")
  assert.equal(baseName("\u{F057} feat x"), "feat x")
  assert.equal(baseName("feat x"), "feat x")
})

test("the totals text for zjstatus", () => {
  assert.equal(
    totalsText({ waiting: 1, failed: 0, done: 2, working: 3 }),
    "#[fg=#fab387]\u{F0F3} 1  #[fg=#a6e3a1]\u{F00C} 2  #[fg=#f9e2af]\u{F051F} 3",
  )
  assert.equal(totalsText({ failed: 1 }), "#[fg=#f38ba8]\u{F057} 1")
  assert.equal(totalsText({ waiting: 0, failed: 0, done: 0, working: 0 }), "")
})

// The adapter with a kit whose run() records the commands and answers from
// `answers` (by the zellij arguments after the session).
const recording = (answers: Record<string, string>, failing: string[] = []) => {
  const calls: string[][] = []
  const kit: Kit = {
    config: DEFAULTS,
    run: async (argv): Promise<RunResult> => {
      calls.push(argv)
      const key = argv.slice(3).join(" ")
      if (failing.includes(key)) return { ok: false, stdout: "", stderr: "boom\n" }
      return { ok: true, stdout: answers[key] ?? "", stderr: "" }
    },
  }
  return { mux: zellij(kit).connect({ session: "test", pane: "3" }), calls }
}
const tabsJson = JSON.stringify([
  { tab_id: 0, name: "A", active: true },
  { tab_id: 4, name: "\u{F00C} B", active: false },
])

test("every command names the session", async () => {
  const { mux, calls } = recording({ "action list-panes --json": fixture("zellij-list-panes.json") })
  assert.equal((await mux.panes()).length, 6)
  assert.deepEqual(calls, [["zellij", "--session", "test", "action", "list-panes", "--json"]])
})

test("markTab renames the tab only when its mark changes", async () => {
  const { mux, calls } = recording({ "action list-tabs --json": tabsJson })
  await mux.markTab!("0", "working")
  await mux.markTab!("4", "done")
  await mux.markTab!("4", "none")
  await mux.markTab!("9", "waiting") // no such tab
  assert.deepEqual(
    calls.filter((argv) => argv[4] === "rename-tab-by-id"),
    [
      ["zellij", "--session", "test", "action", "rename-tab-by-id", "0", "\u{F051F} A"],
      ["zellij", "--session", "test", "action", "rename-tab-by-id", "4", "B"],
    ],
  )
})

test("marks: each tab's mark, from its name", async () => {
  const { mux } = recording({ "action list-tabs --json": tabsJson })
  assert.deepEqual(await mux.marks!(), new Map([["0", "none"], ["4", "done"]]))
})

test("showTotals pipes the text to zjstatus; a blank one when there is nothing", async () => {
  const { mux, calls } = recording({})
  await mux.showTotals!({ waiting: 2, failed: 0, done: 1, working: 0 })
  await mux.showTotals!({ waiting: 0, failed: 0, done: 0, working: 0 })
  assert.deepEqual(calls, [
    ["zellij", "--session", "test", "pipe", "--", "zjstatus::pipe::pipe_agents::#[fg=#fab387]\u{F0F3} 2  #[fg=#a6e3a1]\u{F00C} 1"],
    ["zellij", "--session", "test", "pipe", "--", "zjstatus::pipe::pipe_agents:: "],
  ])
})

test("a failing zellij command fails the operation", async () => {
  const { mux, calls } = recording({ "action list-tabs --json": tabsJson }, ["action rename-tab-by-id 0 \u{F00C} A"])
  await assert.rejects(mux.markTab!("0", "done"), /zellij action rename-tab-by-id: boom$/)
  await assert.rejects(recording({}, ["action list-panes --json"]).mux.panes(), /zellij action list-panes: boom$/)
  assert.equal(calls.length, 2)
})
