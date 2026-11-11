import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DEFAULTS } from "../src/config.ts"
import { makeKit, run } from "../src/kit.ts"

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

test("makeKit reads the config, unless given one", () => {
  const empty = mkdtempSync(join(tmpdir(), "ade-kit-"))
  assert.deepEqual(makeKit({ env: { XDG_CONFIG_HOME: empty } }).config, DEFAULTS)
  const config = { ...DEFAULTS, multiplexer: "none" }
  assert.equal(makeKit({ config }).config, config)
  assert.equal(makeKit({ config }).run, run)
})
