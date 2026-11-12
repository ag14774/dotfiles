import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DEFAULTS } from "../../ade-kit/src/config.ts"
import { makeKit } from "../../ade-kit/src/kit.ts"
import type { Config } from "../../ade-kit/src/types.ts"
import { serverDigest } from "../src/digest.ts"
import { environment, environmentFor } from "../src/environment.ts"

// The instructions as the ADE plugin attached them before they came from the
// config (plugins/ade.ts).
const BEFORE = [
  "This conversation is shown in OpenCode inside a Zellij terminal tab. Each tab belongs to one git worktree of",
  "the project, managed with the user's `wt` command, and also has a shell pane and a Helix editor pane.",
  "- To show the user a file, use the show_file tool. To see how the project's worktrees and their",
  "  conversations are doing, use the status tool.",
  "- Work in another worktree only when the user asks (for example \"delegate this\" or \"do this in a new",
  "  worktree\"), with the delegate tool. Don't create worktrees, tabs or panes yourself (with git, wt, zellij",
  "  or OpenCode's worktree tools).",
].join("\n")

const kitWith = (more: Partial<Config> = {}) => makeKit({ config: { ...structuredClone(DEFAULTS), ...more } as Config })

// Since then: delegate and status take `directory`.
const NOW = [
  BEFORE,
  "- delegate and status work on the repository of this conversation's folder. For another repository, give",
  "  them a folder in it as `directory`; there is no need to move this conversation first.",
].join("\n")

test("with the default config, the instructions are the ones attached before, and say how to reach another repository", async () => {
  assert.equal(await environmentFor(kitWith()), NOW)
  assert.equal(await environmentFor(makeKit({ env: { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "ade-env-")) } })), NOW)
})

test("the instructions name the configured multiplexer and editor; without a multiplexer there are none", async () => {
  const text = await environmentFor(kitWith({ editor: "mitos" }))
  assert.match(text ?? "", /a shell pane and a Mitos editor pane\./)
  assert.match(environment({ multiplexer: "tmux", command: "tmux", editor: "Emacs" }), /inside a tmux terminal tab.*an Emacs editor pane.*with git, wt, tmux$/ms)
  assert.equal(await environmentFor(kitWith({ multiplexer: "none" })), undefined)
})

test("the server's fingerprint covers its files", () => {
  assert.match(serverDigest() ?? "", /^[0-9a-f]{16}$/)
})
