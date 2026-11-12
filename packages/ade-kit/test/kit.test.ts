import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DEFAULTS } from "../src/config.ts"
import { keys, makeKit, quote, run } from "../src/kit.ts"

test("run: a command's output, never through a shell", async () => {
  assert.deepEqual(await run(["echo", "a $HOME b"]), { ok: true, stdout: "a $HOME b\n", stderr: "" })
  assert.deepEqual(await run(["pwd"], { cwd: "/" }), { ok: true, stdout: "/\n", stderr: "" })
})

test("run closes stdin, after the given text", async () => {
  assert.equal((await run(["cat"])).stdout, "")
  assert.equal((await run(["cat"], { stdin: "some text" })).stdout, "some text")
})

test("run reports failures instead of throwing", async () => {
  const failed = await run(["sh", "-c", "echo out; echo err >&2; exit 3"])
  assert.deepEqual(failed, { ok: false, stdout: "out\n", stderr: "err\n" })
  const missing = await run(["ade-no-such-command"])
  assert.equal(missing.ok, false)
  assert.match(missing.stderr, /ENOENT/)
  assert.deepEqual(await run([]), { ok: false, stdout: "", stderr: "nothing to run" })
  assert.equal((await run(["sleep", "5"], { timeout: 200 })).ok, false)
})

test("makeKit reads the config, unless given one, and runs commands with run(), unless given another", () => {
  const empty = mkdtempSync(join(tmpdir(), "ade-kit-"))
  assert.deepEqual(makeKit({ env: { XDG_CONFIG_HOME: empty } }).config, DEFAULTS)
  const config = { ...DEFAULTS, multiplexer: "none" }
  assert.equal(makeKit({ config }).config, config)
  assert.equal(makeKit({ config }).run, run)
  const mine = async () => ({ ok: true, stdout: "", stderr: "" })
  assert.equal(makeKit({ config, run: mine }).run, mine)
})

test("quoting: the quote inside doubled, backslashes as they are", () => {
  assert.equal(quote.double('/a "b" \\c'), '"/a ""b"" \\c"')
  assert.equal(quote.double("/plain path"), '"/plain path"')
  assert.equal(quote.single("it's"), "'it''s'")
})

test("keys: Escape, Enter and text", () => {
  assert.deepEqual([keys.escape, keys.enter, keys.text("x")], [{ key: "escape" }, { key: "enter" }, { text: "x" }])
})

test("the built-in adapters, by name, to start from", () => {
  const kit = makeKit({ config: DEFAULTS })
  assert.equal(kit.builtin.editor("helix").name, "helix")
  assert.deepEqual(kit.builtin.editor("mitos").programs, ["ms"])
  assert.throws(() => kit.builtin.editor("toString"), /there is no built-in editor named "toString"/)
  assert.equal(kit.builtin.agent("opencode").name, "opencode")
  assert.throws(() => kit.builtin.agent("helix"), /there is no built-in agent named "helix"/)
  assert.equal(kit.builtin.reviewer("tuicr").name, "tuicr")
})
