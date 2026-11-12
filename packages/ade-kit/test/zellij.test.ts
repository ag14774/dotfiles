import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DEFAULTS } from "../src/config.ts"
import { makeKit } from "../src/kit.ts"
import zellij, { parsePanes, parseTabs } from "../src/multiplexers/zellij.ts"
import type { RunResult } from "../src/types.ts"

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
  const adapter = zellij(makeKit({ config: DEFAULTS, run: async () => ({ ok: true, stdout: "", stderr: "" }) }))
  const env = { ZELLIJ: "0", ZELLIJ_SESSION_NAME: "main", ZELLIJ_PANE_ID: "7" }
  assert.deepEqual(adapter.here(env), { session: "main", pane: "7" })
  for (const name of Object.keys(env)) assert.equal(adapter.here({ ...env, [name]: undefined }), undefined)
  assert.equal(adapter.here({ ...env, ZELLIJ_PANE_ID: "" }), undefined)
})

// The adapter with a kit whose run() records the commands and answers from
// `answers` (by the zellij arguments after the session; a list answers in
// turn, its last answer repeating).
const recording = (answers: Record<string, string | string[]>, failing: string[] | Record<string, string> = []) => {
  const failures: Record<string, string> = Array.isArray(failing)
    ? Object.fromEntries(failing.map((key) => [key, "boom\n"]))
    : failing
  const calls: string[][] = []
  const kit = makeKit({
    config: DEFAULTS,
    run: async (argv): Promise<RunResult> => {
      calls.push(argv)
      const key = argv.slice(3).join(" ")
      if (key in failures) return { ok: false, stdout: "", stderr: failures[key] }
      const answer = answers[key] ?? ""
      return { ok: true, stdout: Array.isArray(answer) ? (answer.length > 1 ? answer.shift()! : answer[0]) : answer, stderr: "" }
    },
  })
  return { mux: zellij(kit).connect({ session: "test", pane: "3" }), calls }
}
// The zellij arguments after `action`, one string per call.
const actions = (calls: string[][]) => calls.map((argv) => argv.slice(4).join(" "))
test("every command names the session", async () => {
  const { mux, calls } = recording({
    "action list-panes --json": fixture("zellij-list-panes.json"),
    "action list-tabs --json": fixture("zellij-list-tabs.json"),
  })
  assert.equal((await mux.panes()).length, 6)
  assert.equal((await mux.tabs()).length, 2)
  assert.deepEqual(calls, [
    ["zellij", "--session", "test", "action", "list-panes", "--json"],
    ["zellij", "--session", "test", "action", "list-tabs", "--json"],
  ])
})

test("a failing zellij command fails the operation", async () => {
  await assert.rejects(recording({}, ["action list-tabs --json"]).mux.tabs(), /zellij action list-tabs: boom$/)
  await assert.rejects(recording({}, ["action list-panes --json"]).mux.panes(), /zellij action list-panes: boom$/)
})

test("type: text as characters, Escape and Enter as bytes, into the pane", async () => {
  const { mux, calls } = recording({})
  await mux.type("7", [{ key: "escape" }, { text: ':open "/a b"' }, { key: "enter" }])
  assert.deepEqual(calls.map((argv) => argv.slice(4)), [
    ["write", "--pane-id", "terminal_7", "27"],
    ["write-chars", "--pane-id", "terminal_7", ':open "/a b"'],
    ["write", "--pane-id", "terminal_7", "13"],
  ])
  await mux.focus("7")
  assert.deepEqual(actions(calls).at(-1), "focus-pane-id terminal_7")
})

test("start in place of a stopped pane: the pane closes with its program, focus as asked", async () => {
  const { mux, calls } = recording({ "action new-pane --in-place --pane-id terminal_8 --close-replaced-pane --close-on-exit --no-focus -n editor -- hx a.md": "terminal_12\n" })
  assert.equal(await mux.start({ tab: "4", role: "editor", argv: ["hx", "a.md"], focus: false, replace: "8" }), "12")
  assert.deepEqual(actions(calls), ["new-pane --in-place --pane-id terminal_8 --close-replaced-pane --close-on-exit --no-focus -n editor -- hx a.md"])
  const focused = recording({})
  await focused.mux.start({ tab: "4", role: "agent", argv: ["oc"], focus: true, replace: "8" }).catch(() => {})
  assert.deepEqual(actions(focused.calls)[0], "new-pane --in-place --pane-id terminal_8 --close-replaced-pane --close-on-exit -n opencode -- oc")
})

// Tab 1 after `new-pane` printed terminal_9: main at row $main, the editor at
// row $editor (a bar, a plugin pane, at row 0 is ignored).
const geometry = (editor: number, main = 1) =>
  JSON.stringify([
    { id: 0, is_plugin: true, tab_id: 1, title: "zjstatus", pane_y: 0 },
    { id: 1, is_plugin: false, tab_id: 1, title: "main", pane_y: main },
    { id: 2, is_plugin: false, tab_id: 1, title: "opencode", pane_y: 1 },
    { id: 9, is_plugin: false, tab_id: 1, title: "editor", pane_y: editor },
  ])
const spawned = { "action new-pane --close-on-exit -n editor -- hx a.md": "terminal_9\n" }
const spawnEditor = async (panes: string[]) => {
  const { mux, calls } = recording({ ...spawned, "action list-panes --json": panes })
  assert.equal(await mux.start({ tab: "1", role: "editor", argv: ["hx", "a.md"], focus: true }), "9")
  return actions(calls).filter((call) => call !== "list-panes --json")
}

test("a new editor that lands above the shell pane is left where it is", async () => {
  assert.deepEqual(await spawnEditor([geometry(1, 35)]), [
    "go-to-tab-by-id 1",
    "new-pane --close-on-exit -n editor -- hx a.md",
    "focus-pane-id terminal_9",
  ])
})

test("a new editor beside or below the shell pane: the swap layout again, and if it stays below, moved up", async () => {
  // Beside it (a rearranged tab): the swap layout puts it on top.
  assert.deepEqual(await spawnEditor([geometry(1), geometry(1, 35)]), [
    "go-to-tab-by-id 1",
    "new-pane --close-on-exit -n editor -- hx a.md",
    "next-swap-layout",
    "focus-pane-id terminal_9",
  ])
  // Below it (Zellij 0.46 keeps the pane order): moved up.
  assert.deepEqual(await spawnEditor([geometry(35)]), [
    "go-to-tab-by-id 1",
    "new-pane --close-on-exit -n editor -- hx a.md",
    "next-swap-layout",
    "move-pane --pane-id terminal_9 up",
    "focus-pane-id terminal_9",
  ])
})

test("a new pane that new-pane doesn't name is found by its name in the tab", async () => {
  const later = JSON.stringify([{ id: 5, is_plugin: false, tab_id: 2, title: "editor" }, { id: 6, is_plugin: false, tab_id: 1, title: "editor" }])
  const { mux } = recording({ "action list-panes --json": ["[]", later] })
  assert.equal(await mux.start({ tab: "1", role: "editor", argv: ["hx"], focus: true }), "6")
})

test("a new pane only opens in the tab you are on, and a failing start fails", async () => {
  const { mux, calls } = recording({})
  await assert.rejects(mux.start({ tab: "1", role: "editor", argv: ["hx"], focus: false }), /only open in the tab you are on/)
  assert.deepEqual(calls, [])
  const failing = recording({}, ["action new-pane --close-on-exit -n editor -- hx"])
  await assert.rejects(failing.mux.start({ tab: "1", role: "editor", argv: ["hx"], focus: true }), /zellij action new-pane: boom$/)
})

test("focusing the pane that has focus is fine (Zellij 0.46 calls it an error); other failures fail", async () => {
  const focused = recording({}, { "action focus-pane-id terminal_7": "Pane Terminal(7) is already focused\n" })
  await focused.mux.focus("7")
  const { mux } = recording({ ...spawned, "action list-panes --json": geometry(1, 35) }, { "action focus-pane-id terminal_9": "Pane Terminal(9) is already focused" })
  assert.equal(await mux.start({ tab: "1", role: "editor", argv: ["hx", "a.md"], focus: true }), "9")
  await assert.rejects(recording({}, ["action focus-pane-id terminal_7"]).mux.focus("7"), /zellij action focus-pane-id: boom$/)
})
