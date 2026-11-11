import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { DEFAULTS } from "../src/config.ts"
import { loadAdapter, loadMultiplexer } from "../src/load.ts"
import type { Config, Kit } from "../src/types.ts"

const dir = mkdtempSync(join(tmpdir(), "ade-load-"))
const kitWith = (multiplexer: string): Kit => ({
  config: { ...structuredClone(DEFAULTS), multiplexer } as Config,
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
const mux = "connect: () => ({ panes: async () => [], tabs: async () => [] })"

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
  assert.throws(() => loaded?.connect({ session: "s", pane: "1" }), /the multiplexer "fake" lacks: tabs$/)
})

test("a module that doesn't export a function, or can't be loaded, is refused", async () => {
  const path = adapter("object", "export default { api: 1 }")
  await assert.rejects(loadMultiplexer(kitWith(path)), /must export a function \(kit => adapter\)/)
  await assert.rejects(loadMultiplexer(kitWith(join(dir, "missing.ts"))), /cannot load the multiplexer \//)
})
