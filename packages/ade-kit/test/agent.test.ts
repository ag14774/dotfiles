import assert from "node:assert/strict"
import { mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pasteAgent } from "../src/agent.ts"
import opencode from "../src/agents/opencode.ts"
import { DEFAULTS } from "../src/config.ts"
import { makeKit } from "../src/kit.ts"
import type { Config, Key, Multiplexer, RunResult } from "../src/types.ts"

const workspace = { dir: "/w", session: "ade-12345678" }

// A multiplexer that only records what it was asked to paste and type.
const recorder = () => {
  const calls: unknown[][] = []
  const mux = {
    paste: async (pane: string, text: string) => void calls.push(["paste", pane, text]),
    type: async (pane: string, keys: Key[]) => void calls.push(["type", pane, keys]),
  } as unknown as Multiplexer
  return { mux, calls }
}

test("pasteAgent: insert pastes into the agent's pane; submit pastes, then presses Enter", async () => {
  const agent = pasteAgent({ name: "claude-code", label: "Claude Code", start: () => ["claude"] })
  const { mux, calls } = recorder()
  await agent.insert("a question", { workspace, mux, pane: "3" })
  await agent.submit("comments", { workspace, mux, pane: "3" })
  assert.deepEqual(calls, [
    ["paste", "3", "a question"],
    ["paste", "3", "comments"],
    ["type", "3", [{ key: "enter" }]],
  ])
  assert.deepEqual(agent.start({}), ["claude"])
  await assert.rejects(
    agent.insert("x", { workspace }),
    /^Error: Claude Code is reached through its pane, which needs a multiplexer$/,
  )
})

test("OpenCode: pasted into; started with the configured command, on a conversation or a prompt; marks its agents' commands", () => {
  const plain = opencode(makeKit({ config: DEFAULTS }))
  assert.deepEqual([plain.name, plain.label], ["opencode", "OpenCode"])
  assert.deepEqual(plain.start({}), ["opencode"])
  const config = { ...DEFAULTS, opencode: { command: ["opencode-pane"] } } as Config
  assert.deepEqual(opencode(makeKit({ config })).start({ session: "ses_1", prompt: "go" }), [
    "opencode-pane",
    "--session",
    "ses_1",
    "--prompt",
    "go",
  ])
  assert.equal(plain.ranByAgent?.({ OPENCODE_TERMINAL: "1" }), true)
  assert.equal(plain.ranByAgent?.({ OPENCODE_TERMINAL: "" }), false)
  assert.equal(plain.ranByAgent?.({}), false)
  for (const command of ["opencode", [], [1]])
    assert.throws(
      () => opencode(makeKit({ config: { ...DEFAULTS, opencode: { command } } as Config })),
      /opencode\.command must be a list of strings/,
    )
})

// OpenCode, its CLI answering each command (by its arguments) as given, and
// the commands it ran (anything else succeeds with no output).
const opencodeAnswering = (answers: Record<string, RunResult>) => {
  const ran: { argv: string[]; env?: Record<string, string | undefined> }[] = []
  const run = async (argv: string[], o?: { env?: Record<string, string | undefined> }) => {
    ran.push({ argv, env: o?.env })
    return answers[argv.slice(1).join(" ")] ?? { ok: true, stdout: "", stderr: "" }
  }
  return { agent: opencode(makeKit({ config: DEFAULTS, run })), ran }
}
const ok = (stdout: string) => ({ ok: true, stdout, stderr: "" })
const failed = (stderr: string) => ({ ok: false, stdout: "", stderr })

test("OpenCode forgetGone: a stopped service, or no opencode, is asked nothing more (opencode api would start one)", async () => {
  for (const status of [ok("stopped\n"), failed("spawn opencode ENOENT")]) {
    const { agent, ran } = opencodeAnswering({ "service status": status })
    assert.deepEqual(await agent.forgetGone?.({}), [])
    assert.deepEqual(
      ran.map((r) => r.argv),
      [["opencode", "service", "status"]],
    )
  }
})

test("OpenCode forgetGone: the running service evicts only the locations whose folders are gone; failures say why", async () => {
  const here = realpathSync(mkdtempSync(join(tmpdir(), "ade-agent-")))
  const gone = join(here, "removed worktree")
  const evict = `api delete /api/debug/location?location%5Bdirectory%5D=${encodeURIComponent(gone)}`
  const running = {
    "service status": ok("http://127.0.0.1:4096\n"),
    "api get /api/debug/location": ok(JSON.stringify([{ directory: here }, { directory: gone }])),
  }
  const env = { HOME: "/home/me" }
  const { agent, ran } = opencodeAnswering(running)
  assert.deepEqual(await agent.forgetGone?.(env), [gone])
  assert.deepEqual(
    ran.map((r) => r.argv.slice(1).join(" ")),
    ["service status", "api get /api/debug/location", evict],
  )
  assert.ok(ran.every((r) => r.env === env))
  for (const [listed, why] of [
    [failed("Error: Not Found\n    at cli.api"), "Error: Not Found"],
    [ok("<!doctype html>\n<html>"), "<!doctype html>"],
  ] as const)
    await assert.rejects(
      opencodeAnswering({ ...running, "api get /api/debug/location": listed }).agent.forgetGone!({}),
      new Error(`could not list OpenCode's locations: ${why}`),
    )
  await assert.rejects(
    opencodeAnswering({ ...running, [evict]: failed("Error: boom") }).agent.forgetGone!({}),
    new Error(`OpenCode could not let go of ${gone}: Error: boom`),
  )
})
