import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DEFAULTS } from "../src/config.ts"
import { listed, onPath, typedEditor } from "../src/editor.ts"
import helix from "../src/editors/helix.ts"
import mitos from "../src/editors/mitos.ts"
import { makeKit } from "../src/kit.ts"
import type { Key, Multiplexer } from "../src/types.ts"

const kit = makeKit({ config: DEFAULTS })
const workspace = { dir: "/w", session: "ade-12345678" }

// A multiplexer that only records what it was asked to type.
const recorder = () => {
  const typed: [string, Key[]][] = []
  const mux = { type: async (pane: string, keys: Key[]) => void typed.push([pane, keys]) } as unknown as Multiplexer
  return { mux, typed }
}

// A PATH with executables (and a plain file) in two folders.
const bin = mkdtempSync(join(tmpdir(), "ade-editor-"))
for (const dir of ["one", "two"]) mkdirSync(join(bin, dir))
const file = (path: string, executable: boolean) => {
  writeFileSync(join(bin, path), "#!/bin/sh\n")
  chmodSync(join(bin, path), executable ? 0o755 : 0o644)
}
file("one/plain", false)
file("one/b", true)
file("two/a", true)
file("two/plain", true)
const PATH = `${join(bin, "one")}::${join(bin, "two")}`

test("onPath: the first program found, searching PATH for each in turn; plain files don't count", () => {
  assert.equal(onPath(["a", "b"], PATH), join(bin, "two/a"))
  assert.equal(onPath(["c", "b"], PATH), join(bin, "one/b"))
  assert.equal(onPath(["plain"], PATH), join(bin, "two/plain"))
  assert.equal(onPath(["c"], PATH), undefined)
  assert.equal(listed(["hx"]), "hx")
  assert.equal(listed(["hx", "helix"]), "hx and helix")
  assert.equal(listed(["a", "b", "c"]), "a, b and c")
})

const sample = (more = {}) =>
  typedEditor({
    name: "sample",
    label: "Sample",
    programs: ["c", "b"],
    open: (f) => [kit.keys.text(`open ${f.path}`), kit.keys.enter],
    supports: { line: false, reload: "none" },
    ...more,
  })

test("typedEditor types each file's keys into the editor pane, in one go", async () => {
  const { mux, typed } = recorder()
  await sample().open([{ path: "/a" }, { path: "/b" }], { workspace, mux, pane: "4" })
  assert.deepEqual(typed, [["4", [{ text: "open /a" }, { key: "enter" }, { text: "open /b" }, { key: "enter" }]]])
})

test("typedEditor needs the pane, and so a multiplexer", async () => {
  await assert.rejects(sample().open([{ path: "/a" }], { workspace }), /^Error: Sample is reached through its pane, which needs a multiplexer$/)
  await assert.rejects(sample().open([{ path: "/a" }], { workspace, mux: recorder().mux }), /needs a multiplexer/)
})

test("typedEditor starts the first of its programs on PATH, with the files; or says it found none", () => {
  const path = process.env.PATH
  try {
    process.env.PATH = PATH
    assert.deepEqual(sample().start([{ path: "/a" }, { path: "/b", line: 3 }], workspace), [join(bin, "one/b"), "/a", "/b"])
    process.env.PATH = join(bin, "nowhere")
    assert.throws(() => sample().start([], workspace), /^Error: Sample executable not found \(tried c and b\)$/)
  } finally {
    process.env.PATH = path
  }
  assert.deepEqual(sample({ start: () => ["mine"] }).start([], workspace), ["mine"])
})

test("typedEditor: no remote control; reload only when given", async () => {
  assert.deepEqual(sample().supports, { line: false, reload: "none", remote: false })
  assert.equal(sample().reload, undefined)
  const { mux, typed } = recorder()
  await sample({ reload: () => [kit.keys.text(":reload-all")] }).reload?.({ workspace, mux, pane: "2" })
  assert.deepEqual(typed, [["2", [{ text: ":reload-all" }]]])
})

// As Helix 25.07 reads its command line (checked live): a quote inside quotes
// is doubled, and %{...} is expanded inside double quotes only.
test("Helix and Mitos: Escape, then :open with the path quoted, then Enter", async () => {
  for (const editor of [helix(kit), mitos(kit)]) {
    const { mux, typed } = recorder()
    await editor.open([{ path: '/w/a "b".md', line: 3 }, { path: "/w/50%{x}'s.md" }], { workspace, mux, pane: "1" })
    assert.deepEqual(typed, [
      ["1", [
        { key: "escape" }, { text: ':open "/w/a ""b"".md"' }, { key: "enter" },
        { key: "escape" }, { text: ":open '/w/50%{x}''s.md'" }, { key: "enter" },
      ]],
    ])
    assert.equal(editor.supports.line, false)
  }
  assert.deepEqual([helix(kit).name, helix(kit).label, helix(kit).programs], ["helix", "Helix", ["hx", "helix"]])
  assert.deepEqual([mitos(kit).name, mitos(kit).label, mitos(kit).programs], ["mitos", "Mitos", ["ms"]])
  assert.equal(helix(kit).supports.reload, "none")
  assert.equal(mitos(kit).supports.reload, "watches")
})
