// What adapters get (see types.ts), so they don't reimplement anything.
import { execFile } from "node:child_process"
import { pasteAgent } from "./agent.ts"
import opencode from "./agents/opencode.ts"
import { readConfig } from "./config.ts"
import { typedEditor } from "./editor.ts"
import helix from "./editors/helix.ts"
import mitos from "./editors/mitos.ts"
import tuicr from "./reviewers/tuicr.ts"
import type { Agent, Config, Editor, Key, Kit, Reviewer, RunOptions, RunResult } from "./types.ts"

const TIMEOUT_MS = 10_000

export function run(argv: string[], o: RunOptions = {}): Promise<RunResult> {
  return new Promise((done) => {
    const [command, ...args] = argv
    const failed = (message: string) => done({ ok: false, stdout: "", stderr: message })
    if (!command) return failed("nothing to run")
    try {
      const options = { cwd: o.cwd, env: o.env ?? process.env, timeout: o.timeout ?? TIMEOUT_MS }
      const child = execFile(command, args, options, (error, stdout, stderr) =>
        done({ ok: !error, stdout: String(stdout), stderr: String(stderr) || (error ? error.message : "") }),
      )
      // Some commands (`zellij pipe`) wait for stdin as long as it is open.
      child.stdin?.on("error", () => {})
      child.stdin?.end(o.stdin ?? "")
    } catch (error) {
      failed((error as Error).message)
    }
  })
}

// A quote inside is doubled (Helix 25.07 and Kakoune have no backslash escapes).
export const quote = {
  double: (text: string) => `"${text.replaceAll('"', '""')}"`,
  single: (text: string) => `'${text.replaceAll("'", "''")}'`,
}

export const keys = {
  escape: { key: "escape" } as Key,
  enter: { key: "enter" } as Key,
  text: (text: string): Key => ({ text }),
}

const EDITORS: Record<string, (kit: Kit) => Editor> = { helix, mitos }
const AGENTS: Record<string, (kit: Kit) => Agent> = { opencode }
const REVIEWERS: Record<string, (kit: Kit) => Reviewer> = { tuicr }

const builtin = <T>(adapters: Record<string, (kit: Kit) => T>, kind: string, name: string, kit: Kit) => {
  const make = Object.hasOwn(adapters, name) ? adapters[name] : undefined
  if (!make) throw new Error(`ade: there is no built-in ${kind} named "${name}"`)
  return make(kit)
}

export function makeKit(
  o: { config?: Config; env?: Record<string, string | undefined>; run?: Kit["run"] } = {},
): Kit {
  const kit: Kit = {
    config: o.config ?? readConfig(o.env),
    run: o.run ?? run,
    quote,
    keys,
    typedEditor,
    pasteAgent,
    builtin: {
      editor: (name) => builtin(EDITORS, "editor", name, kit),
      agent: (name) => builtin(AGENTS, "agent", name, kit),
      reviewer: (name) => builtin(REVIEWERS, "reviewer", name, kit),
    },
  }
  return kit
}
