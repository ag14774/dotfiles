// What adapters get (see types.ts), so they don't reimplement anything.
import { execFile } from "node:child_process"
import { readConfig } from "./config.ts"
import type { Config, Kit, RunOptions, RunResult } from "./types.ts"

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

export function makeKit(o: { config?: Config; env?: Record<string, string | undefined> } = {}): Kit {
  return { config: o.config ?? readConfig(o.env), run }
}
