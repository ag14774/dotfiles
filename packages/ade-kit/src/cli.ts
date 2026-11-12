#!/usr/bin/env node
// The `ade` command: ade-kit's actions (actions.ts) for scripts and
// keybindings. Results on stdout, messages on stderr; the exit status is 2
// for wrong usage and 1 when the action fails. Stowed as ~/.local/bin/ade.
//
// Debug: set ADE_LOG to a file to append each command it runs.
import { spawn } from "node:child_process"
import { once } from "node:events"
import { appendFileSync } from "node:fs"
import type { Terminal } from "./actions.ts"
import { open, review, send } from "./actions.ts"
import { makeKit, run } from "./kit.ts"
import { scopeOf, scopeWords } from "./review.ts"
import type { RunOptions } from "./types.ts"
import { workspaceOf } from "./workspace.ts"

const USAGE = `usage: ade open FILE[:LINE[:COLUMN]]...
         open files in this tab's editor
       ade send FILE [START [END [LANGUAGE]]] [< SELECTION]
         give this tab's agent a place in a file (and the text selected there), then focus it
       ade send --text [--submit] < TEXT
         give it text as it is (with --submit, send it as a message)
       ade review
         review this worktree's changes since origin/HEAD, then give the agent your comments
       ade review --scope
         what a review here covers: -r BASE..HEAD (commits), -w (uncommitted changes)`

class UsageError extends Error {}

// Like the shell's $(cat): without the trailing newlines; nothing from a terminal.
const input = async () => {
  if (process.stdin.isTTY) return ""
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8").replace(/\n+$/, "")
}

// The review runs in this terminal, which shows its messages until a key.
const terminal: Terminal = {
  interact: (argv, o) =>
    new Promise((done) => {
      const [command, ...args] = argv
      const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ["inherit", "pipe", "inherit"] })
      const chunks: Buffer[] = []
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
      child.on("error", (error) => done({ stdout: "", error: error.message }))
      child.on("close", () => done({ stdout: Buffer.concat(chunks).toString("utf8") }))
    }),
  pause: async (message) => {
    process.stderr.write(`${message}\n\nPress any key to close.`)
    if (!process.stdin.isTTY) return
    process.stdin.setRawMode(true)
    process.stdin.resume()
    await once(process.stdin, "data")
    process.stdin.setRawMode(false)
    process.stdin.pause()
  },
}

const traced = (log: string) => async (argv: string[], o?: RunOptions) => {
  const result = await run(argv, o)
  const time = new Date().toTimeString().slice(0, 8)
  appendFileSync(log, `${time} ${JSON.stringify(argv)}${result.ok ? "" : ` failed: ${result.stderr.trim()}`}\n`)
  return result
}

async function main(command: string | undefined, args: string[]) {
  const env = process.env
  const kit = () => makeKit({ env, ...(env.ADE_LOG ? { run: traced(env.ADE_LOG) } : {}) })
  const caller = { env, cwd: process.cwd() }
  switch (command) {
    case "open":
      if (!args.length) throw new UsageError()
      return open(kit(), args, caller)
    case "send": {
      if (args.includes("--text")) {
        const submit = args.includes("--submit")
        if (args.length !== (submit ? 2 : 1)) throw new UsageError()
        const text = await input()
        if (!text) throw new Error("no text to send on stdin")
        return send(kit(), { text, submit }, caller)
      }
      if (args.length < 1 || args.length > 4) throw new UsageError()
      const [file, start, end, language] = args
      return send(kit(), { file, start, end, language, selection: await input() }, caller)
    }
    case "review": {
      if (args.length === 1 && args[0] === "--scope") {
        const k = kit()
        const workspace = await workspaceOf(k, caller.cwd)
        if (!workspace) throw new Error(`${caller.cwd} is not in a Git repository`)
        for (const word of scopeWords(await scopeOf(k, workspace.dir))) process.stdout.write(`${word}\n`)
        return
      }
      if (args.length) throw new UsageError()
      return review(kit(), caller, terminal)
    }
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(`${USAGE}\n`)
      return
    default:
      throw new UsageError()
  }
}

const [command, ...args] = process.argv.slice(2)
main(command, args).catch((error: Error) => {
  if (error instanceof UsageError) {
    process.stderr.write(`${USAGE}\n`)
    process.exitCode = 2
    return
  }
  process.stderr.write(`ade ${command}: ${error.message.replace(/^ade: /, "")}\n`)
  process.exitCode = 1
})
