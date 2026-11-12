import assert from "node:assert/strict"
import { test } from "node:test"
import { pasteAgent } from "../src/agent.ts"
import opencode from "../src/agents/opencode.ts"
import { DEFAULTS } from "../src/config.ts"
import { makeKit } from "../src/kit.ts"
import type { Config, Key, Multiplexer } from "../src/types.ts"

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
  assert.deepEqual(calls, [["paste", "3", "a question"], ["paste", "3", "comments"], ["type", "3", [{ key: "enter" }]]])
  assert.deepEqual(agent.start({}), ["claude"])
  await assert.rejects(agent.insert("x", { workspace }), /^Error: Claude Code is reached through its pane, which needs a multiplexer$/)
})

test("OpenCode: pasted into; started with the configured command, on a conversation or a prompt", () => {
  const plain = opencode(makeKit({ config: DEFAULTS }))
  assert.deepEqual([plain.name, plain.label], ["opencode", "OpenCode"])
  assert.deepEqual(plain.start({}), ["opencode"])
  const config = { ...DEFAULTS, opencode: { command: ["opencode-pane"] } } as Config
  assert.deepEqual(opencode(makeKit({ config })).start({ session: "ses_1", prompt: "go" }), [
    "opencode-pane", "--session", "ses_1", "--prompt", "go",
  ])
  for (const command of ["opencode", [], [1]])
    assert.throws(() => opencode(makeKit({ config: { ...DEFAULTS, opencode: { command } } as Config })), /opencode\.command must be a list of strings/)
})
