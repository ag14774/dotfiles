import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DEFAULTS } from "../src/config.ts"
import zellij, { parsePanes, parseTabs } from "../src/multiplexers/zellij.ts"
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
