import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { cliPlugins, disables, parseJsonc, switchedOff } from "../src/cli-config.ts"

const id = "opencode.notifications"

test("plugins entries apply in order; built-in plugins are on unless disabled", () => {
  assert.equal(disables(undefined, id), false)
  assert.equal(disables([], id), false)
  assert.equal(disables(["-opencode.btw", "./tui-plugins/btw-v2"], id), false)
  assert.equal(disables(["-opencode.btw", "./tui-plugins/btw-v2", "-opencode.notifications"], id), true)
  assert.equal(disables(["*", "-opencode.notifications", "-team.*"], id), true) // the docs' example
  assert.equal(disables(["-opencode.*"], id), true)
  assert.equal(disables(["-*"], id), true)
  assert.equal(disables(["-opencode.notifications", "opencode.notifications"], id), false)
  assert.equal(disables(["-opencode.*", "opencode.notifications@1.0.0"], id), false)
  assert.equal(disables(["-opencode.notifications", "*"], id), false)
  assert.equal(disables(["-opencode.notificationsX", "-opencode", "-notifications"], id), false)
  assert.equal(disables([{ package: "-opencode.notifications" }, 3, null], id), true)
})

test("cli.json may have comments and trailing commas", () => {
  assert.deepEqual(parseJsonc('{\n  // the plugins\n  "plugins": ["-a", /* b */ "c",],\n  "u": "http://x/*y*/", }'), {
    plugins: ["-a", "c"],
    u: "http://x/*y*/",
  })
  assert.deepEqual(parseJsonc('{"s": "a, }", "t": "\\" // not a comment"}'), { s: "a, }", t: '" // not a comment' })
  assert.equal(parseJsonc("{ not json"), undefined)
})

test("the settings OpenCode reads: XDG_CONFIG_HOME or ~/.config, OPENCODE_CLI_CONFIG_CONTENT over them", () => {
  const home = mkdtempSync(join(tmpdir(), "cli-config-"))
  mkdirSync(join(home, ".config/opencode"), { recursive: true })
  mkdirSync(join(home, "xdg/opencode"), { recursive: true })
  writeFileSync(join(home, ".config/opencode/cli.json"), '{ "plugins": ["-opencode.notifications"], }')
  writeFileSync(join(home, "xdg/opencode/cli.json"), '{ "plugins": ["-opencode.btw"] }')
  assert.equal(switchedOff(id, {}, home), true)
  assert.equal(switchedOff(id, { XDG_CONFIG_HOME: join(home, "xdg") }, home), false)
  // A list in the variable replaces the file's; other settings there leave it.
  assert.deepEqual(cliPlugins({ OPENCODE_CLI_CONFIG_CONTENT: '{"plugins": []}' }, home), [])
  assert.equal(switchedOff(id, { OPENCODE_CLI_CONFIG_CONTENT: '{"attention": {"sound": false}}' }, home), true)
  assert.equal(switchedOff(id, { XDG_CONFIG_HOME: join(home, "none") }, home), false) // no cli.json
})
