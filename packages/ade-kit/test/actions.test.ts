import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileRef, open } from "../src/actions.ts"
import { DEFAULTS } from "../src/config.ts"
import { makeKit } from "../src/kit.ts"
import type { Config, Key, Multiplexer, Pane, Role, Tab } from "../src/types.ts"

const temp = realpathSync(mkdtempSync(join(tmpdir(), "ade-actions-")))
const dir = join(temp, "work") // not a repository: the workspace is the folder itself
mkdirSync(join(temp, "bin"))
mkdirSync(dir)
writeFileSync(join(dir, "notes.md:12"), "a file whose name ends like a line number\n")
writeFileSync(join(temp, "bin", "hx"), "#!/bin/sh\n")
chmodSync(join(temp, "bin", "hx"), 0o755)
process.env.PATH = `${join(temp, "bin")}:${process.env.PATH}`

// A multiplexer of your own, which hands out the recorder the test sets up.
const fakeMux = join(temp, "fake-mux.ts")
writeFileSync(
  fakeMux,
  `export default () => ({
    api: 1,
    name: "fake",
    label: "Fake",
    here: (env) => (env.FAKE_PANE ? { session: "s", pane: env.FAKE_PANE } : undefined),
    connect: () => globalThis.recorder,
  })`,
)
// An editor that opens files at a line.
const lines = join(temp, "lines.ts")
writeFileSync(
  lines,
  `export default (kit) => kit.typedEditor({
    name: "lines",
    programs: ["hx"],
    open: (f) => [kit.keys.text(JSON.stringify(f))],
    supports: { line: true, reload: "watches" },
  })`,
)

type Call = [string, ...unknown[]]
const pane = (id: string, tab: string, role?: Role, more: Partial<Pane> = {}): Pane => ({
  id,
  tab,
  ...(role ? { role } : {}),
  cwd: dir,
  running: true,
  floating: false,
  focused: false,
  ...more,
})
// You are on tab 1 (shell 1, editor 2, an agent 5 without a known folder).
// Tab 2 has an editor, tab 3 none, tab 4 a stopped one.
const session: Pane[] = [
  pane("1", "1", "shell"),
  pane("2", "1", "editor"),
  pane("5", "1", "agent", { cwd: undefined }),
  pane("3", "2", "shell"),
  pane("4", "2", "editor"),
  pane("6", "3", "shell"),
  pane("7", "4", "shell"),
  pane("8", "4", "editor", { running: false, cwd: undefined }),
]
const tabs: Tab[] = ["1", "2", "3", "4"].map((id) => ({ id, name: id, active: id === "1" }))

const record = (panes: Pane[] = session) => {
  const calls: Call[] = []
  const recorder: Multiplexer = {
    panes: async () => panes,
    tabs: async () => tabs,
    start: async (o) => (calls.push(["start", o]), "9"),
    type: async (pane: string, keys: Key[]) => void calls.push(["type", pane, keys]),
    focus: async (pane: string) => void calls.push(["focus", pane]),
  }
  ;(globalThis as { recorder?: Multiplexer }).recorder = recorder
  return calls
}
const kitWith = (more: Partial<Config> = {}) =>
  makeKit({ config: { ...structuredClone(DEFAULTS), multiplexer: fakeMux, ...more } as Config })
const from = (pane: string | undefined, cwd = dir) => ({ env: pane ? { FAKE_PANE: pane } : {}, cwd })
const typedOpen = (path: string) => [{ key: "escape" }, { text: `:open "${path}"` }, { key: "enter" }]

test("fileRef: paths relative to the caller's folder, with an optional line and column", () => {
  assert.deepEqual(fileRef("a.md", "/w/src"), { path: "/w/src/a.md" })
  assert.deepEqual(fileRef("../a.md:3", "/w/src"), { path: "/w/a.md", line: 3 })
  assert.deepEqual(fileRef("/x/a.md:3:7", "/w"), { path: "/x/a.md", line: 3, column: 7 })
  assert.deepEqual(fileRef("notes.md:12", dir), { path: join(dir, "notes.md:12") }) // that file exists
})

test("open: typed into the editor of the caller's tab, which then gets focus", async () => {
  const calls = record()
  await open(kitWith(), ["notes.md", "/x/b.md"], from("1"))
  assert.deepEqual(calls, [
    ["type", "2", [...typedOpen(join(dir, "notes.md")), ...typedOpen("/x/b.md")]],
    ["focus", "2"],
  ])
  // From the agent pane, whose folder isn't known, the same.
  const again = record()
  await open(kitWith(), ["notes.md"], from("5", "/elsewhere"))
  assert.deepEqual(again, [["type", "2", typedOpen("/elsewhere/notes.md")], ["focus", "2"]])
})

test("open from a tab you are not on: its editor, without focus", async () => {
  const calls = record()
  await open(kitWith(), ["notes.md"], from("3"))
  assert.deepEqual(calls, [["type", "4", typedOpen(join(dir, "notes.md"))]])
})

test("open: a stopped editor is replaced by a fresh one, focused only in the tab you are on", async () => {
  const calls = record()
  await open(kitWith(), ["notes.md"], from("7"))
  const argv = [join(temp, "bin", "hx"), join(dir, "notes.md")]
  assert.deepEqual(calls, [["start", { tab: "4", role: "editor", argv, focus: false, replace: "8" }]])
  const here = record(session.map((p) => (p.id === "2" ? { ...p, running: false } : p)))
  await open(kitWith(), ["notes.md"], from("1"))
  assert.deepEqual(here, [["start", { tab: "1", role: "editor", argv, focus: true, replace: "2" }]])
})

test("open in a tab without an editor: started there if you are on it, else refused", async () => {
  const calls = record(session.filter((p) => p.id !== "2"))
  await open(kitWith(), ["notes.md"], from("1"))
  assert.deepEqual(calls, [["start", { tab: "1", role: "editor", argv: [join(temp, "bin", "hx"), join(dir, "notes.md")], focus: true }]])
  const refused = record()
  await assert.rejects(open(kitWith(), ["notes.md"], from("6")), /^Error: tab 3 has no editor and is not the tab you are on; not switching tabs$/)
  assert.deepEqual(refused, [])
})

test("open refuses, touching nothing, when the caller's pane is gone or it is not inside the multiplexer", async () => {
  const calls = record()
  await assert.rejects(open(kitWith(), ["a"], from("42")), /^Error: pane 42 does not exist; not guessing which tab to use$/)
  await assert.rejects(open(kitWith(), ["a"], from(undefined)), /^Error: not inside Fake$/)
  await assert.rejects(open(kitWith({ multiplexer: "none" }), ["a"], from("1")), /^Error: Helix is reached through its pane, and no multiplexer is configured$/)
  assert.deepEqual(calls, [])
})

test("open passes lines on to an editor that supports them, and drops them for one that doesn't", async () => {
  const calls = record()
  await open(kitWith({ editor: lines }), ["a.md:3:2", "b.md"], from("1"))
  assert.deepEqual(calls[0], [
    "type",
    "2",
    [{ text: JSON.stringify({ path: join(dir, "a.md"), line: 3, column: 2 }) }, { text: JSON.stringify({ path: join(dir, "b.md") }) }],
  ])
  const dropped = record()
  await open(kitWith(), ["a.md:3"], from("1"))
  assert.deepEqual(dropped[0], ["type", "2", typedOpen(join(dir, "a.md"))])
})
