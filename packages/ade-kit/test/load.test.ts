import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { DEFAULTS } from "../src/config.ts"
import { makeKit } from "../src/kit.ts"
import { loadAdapter, loadAgent, loadEditor, loadMultiplexer, loadReviewer } from "../src/load.ts"
import type { Config, Kit } from "../src/types.ts"

const dir = mkdtempSync(join(tmpdir(), "ade-load-"))
const kitWith = (multiplexer: string, more: Partial<Config> = {}): Kit =>
  makeKit({
    config: { ...structuredClone(DEFAULTS), multiplexer, ...more } as Config,
    run: async () => ({ ok: true, stdout: "", stderr: "" }),
  })
// A module of your own in the temporary folder, as a user would write one.
const adapter = (name: string, body: string) => {
  const path = join(dir, `${name}.ts`)
  writeFileSync(path, `import type { Kit } from "${pathToFileURL(join(import.meta.dirname, "../src/types.ts"))}"\n${body}\n`)
  return path
}
const fake = (fields: string) =>
  `export default (kit: Kit) => ({ name: "fake", here: () => undefined, ${fields} })`
const operations = ["panes", "tabs", "start", "type", "paste", "focus"].map((name) => `${name}: async () => []`).join(", ")
const mux = `connect: () => ({ ${operations} })`

test("a built-in name loads the built-in adapter", async () => {
  const zellij = await loadMultiplexer(kitWith("zellij"))
  assert.equal(zellij?.name, "zellij")
  assert.equal(zellij?.api, 1)
  assert.equal(typeof zellij?.connect({ session: "s", pane: "1" }).panes, "function")
})

test('"none" means no multiplexer', async () => {
  assert.equal(await loadMultiplexer(kitWith("none")), undefined)
})

test("an unknown built-in name, or something that is neither a name nor a path, is refused", async () => {
  await assert.rejects(loadMultiplexer(kitWith("tmux")), /there is no built-in multiplexer named "tmux"/)
  await assert.rejects(loadMultiplexer(kitWith("Zel lij")), /"Zel lij" is neither a built-in multiplexer nor a path/)
})

test("a path loads that file, which gets the kit", async () => {
  const path = adapter("mine", fake(`api: 1, layout: kit.config.zellij.layout, ${mux}`))
  const loaded = (await loadAdapter(kitWith(path), "multiplexer", path)) as { name: string; layout: string }
  assert.equal(loaded.name, "fake")
  assert.equal(loaded.layout, "dev")
  assert.equal((await loadMultiplexer(kitWith(path)))?.name, "fake")
})

test("relative paths start from the config's folder; ~/ and file: work too", async () => {
  adapter("relative", fake(`api: 1, ${mux}`))
  assert.equal((await loadMultiplexer(kitWith("./relative.ts"), { base: dir }))?.name, "fake")
  assert.equal((await loadMultiplexer(kitWith(pathToFileURL(join(dir, "relative.ts")).href)))?.name, "fake")
  const home = process.env.HOME
  process.env.HOME = dir
  try {
    assert.equal((await loadMultiplexer(kitWith("~/relative.ts")))?.name, "fake")
  } finally {
    process.env.HOME = home
  }
})

test("an adapter for another api version is refused", async () => {
  const path = adapter("future", fake(`api: 2, ${mux}`))
  await assert.rejects(loadMultiplexer(kitWith(path)), (error: Error) =>
    error.message === `ade: the multiplexer ${path} is written for api 2; this ade-kit has api 1`)
})

test("an adapter missing a required operation is refused, naming what is missing", async () => {
  const path = adapter("partial", "export default () => ({ api: 1 })")
  await assert.rejects(loadMultiplexer(kitWith(path)), (error: Error) =>
    error.message === `ade: the multiplexer ${path} lacks: name, here, connect`)
  const lazy = adapter("lazy", fake("api: 1, connect: () => ({ panes: async () => [] })"))
  const loaded = await loadMultiplexer(kitWith(lazy))
  assert.throws(() => loaded?.connect({ session: "s", pane: "1" }), /the multiplexer "fake" lacks: tabs, start, type, paste, focus$/)
})

test("a module that doesn't export a function, or can't be loaded, is refused", async () => {
  const path = adapter("object", "export default { api: 1 }")
  await assert.rejects(loadMultiplexer(kitWith(path)), /must export a function \(kit => adapter\)/)
  await assert.rejects(loadMultiplexer(kitWith(join(dir, "missing.ts"))), /cannot load the multiplexer \//)
})

test("the editor: a built-in name, or a module of your own that starts from a built-in", async () => {
  const helix = await loadEditor(kitWith("zellij"))
  assert.equal(helix.name, "helix")
  assert.deepEqual(helix.programs, ["hx", "helix"])
  const path = adapter("my-helix", 'export default (kit: Kit) => ({ ...kit.builtin.editor("helix"), programs: ["helix"] })')
  const mine = await loadEditor(kitWith("zellij", { editor: path }))
  assert.equal(mine.name, "helix")
  assert.deepEqual(mine.programs, ["helix"])
  assert.equal(typeof mine.open, "function")
  await assert.rejects(loadEditor(kitWith("zellij", { editor: "vscode" })), /there is no built-in editor named "vscode"/)
})

test("an editor without its programs or what it supports is refused", async () => {
  const path = adapter("bare", 'export default () => ({ api: 1, name: "bare", programs: "bare", start: () => [], open: async () => {} })')
  await assert.rejects(loadEditor(kitWith("zellij", { editor: path })), (error: Error) =>
    error.message === `ade: the editor ${path} lacks: programs, supports`)
})

test("the agent: a built-in name, or a module of your own; one that can't insert or submit is refused", async () => {
  assert.equal((await loadAgent(kitWith("zellij"))).name, "opencode")
  const path = adapter("my-agent", 'export default (kit: Kit) => ({ ...kit.builtin.agent("opencode"), start: () => ["oc"] })')
  assert.deepEqual((await loadAgent(kitWith("zellij", { agent: path }))).start({}), ["oc"])
  const lazy = adapter("lazy-agent", 'export default () => ({ api: 1, name: "lazy", start: () => [] })')
  await assert.rejects(loadAgent(kitWith("zellij", { agent: lazy })), (error: Error) =>
    error.message === `ade: the agent ${lazy} lacks: insert, submit`)
})

test("the reviewer: a built-in name, or a module of your own; one without a command is refused", async () => {
  assert.equal((await loadReviewer(kitWith("zellij"))).name, "tuicr")
  const path = adapter("no-command", 'export default () => ({ api: 1, name: "mine", editorVariable: "EDITOR" })')
  await assert.rejects(loadReviewer(kitWith("zellij", { reviewer: path })), (error: Error) =>
    error.message === `ade: the reviewer ${path} lacks: command`)
})
