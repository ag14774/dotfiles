import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const ade = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, ZELLIJ: "" } })

test("ade help names every command", () => {
  const help = ade("help")
  assert.equal(help.status, 0)
  for (const command of ["open", "send", "review", "workspace", "tabs", "close-tabs"])
    assert.match(help.stdout, new RegExp(`^(usage: | {7})ade ${command} `, "m"))
})

test("wrong usage: the usage on stderr, exit status 2", () => {
  for (const args of [["nonsense"], ["tabs"], ["tabs", "a", "b"], ["workspace"], ["workspace", "a", "--prompt"], ["close-tabs", "a", "1:maybe"]]) {
    const result = ade(...args)
    assert.equal(result.status, 2, args.join(" "))
    assert.match(result.stderr, /^usage: ade open/)
  }
})

test("the actions on tabs need a multiplexer session: exit status 1, saying so", () => {
  const result = ade("tabs", ".")
  assert.equal(result.status, 1)
  assert.equal(result.stderr, "ade tabs: not inside Zellij\n")
})

test("ade works from a folder that is gone (wtrm run inside the worktree it removes)", () => {
  const gone = mkdtempSync(join(realpathSync(tmpdir()), "ade-gone-"))
  const result = spawnSync("sh", ["-c", 'cd "$1" && rmdir "$1" && exec "$2" "$3" tabs /x', "sh", gone, process.execPath, cli], {
    encoding: "utf8",
    env: { ...process.env, ZELLIJ: "" },
  })
  assert.equal(result.stderr, "ade tabs: not inside Zellij\n")
})
