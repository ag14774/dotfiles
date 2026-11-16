#!/usr/bin/env node
// The `ade` command: ade-kit's actions (actions.ts) for scripts and
// keybindings. Results on stdout, messages on stderr; the exit status is 2
// for wrong usage and 1 when the action fails.
//
// Debug: set ADE_LOG to a file to append each command it runs.
import { spawn } from "node:child_process"
import { once } from "node:events"
import { appendFileSync } from "node:fs"
import { homedir } from "node:os"
import { createInterface } from "node:readline"
import type { Terminal } from "./actions.ts"
import { forgetGone, open, restartAgent, review, send, where } from "./actions.ts"
import { makeKit, run } from "./kit.ts"
import { scopeOf, scopeWords } from "./review.ts"
import type { RunOptions } from "./types.ts"
import { workspaceOf } from "./workspace.ts"
import { worktreeCommand } from "./worktree-cli.ts"

const USAGE = `usage: ade open FILE[:LINE[:COLUMN]]...
         open the files in this tab's editor and focus it; with no editor in the tab, start one
         (only in the tab you are on: it never switches tabs)
       ade send FILE [START [END [LANGUAGE]]] [< SELECTION]
         put a reference to those lines of FILE, and the selected text, in this tab's agent
         prompt without sending it, and focus the agent
       ade send --text [--submit] < TEXT
         put TEXT in the agent prompt as it is; with --submit, send it
       ade review
         review what this worktree changed since worktrees.base, committed or not; when you end
         the review, your comments go to this tab's agent (filled in, or sent: review.deliver)
       ade review --scope
         print what a review here covers: -r BASE..HEAD (commits), -w (uncommitted changes)
       ade restart-agent [DIR]
         replace this tab's agent with a fresh one started in DIR (default: here); focus stays
       ade forget-gone
         let the agent forget folders that no longer exist, and print them (OpenCode: its
         service's locations, on which its reload fails); ade worktree rm does it too
       ade where
         print the folder of the focused tiled pane of its own tab (if that pane reports none:
         the tab's agent pane, then its shell pane); outside a multiplexer, or when that folder
         is gone, the folder it was started in
       ade worktree [--cwd-file FILE] COMMAND [ARGS...]
         create, open, list and remove worktrees (see: ade worktree help)`

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

// What an action tells you, as it happens.
const say = (message: string) => void process.stderr.write(`${message}\n`)

// A yes/no question on the terminal (no answer, as at the end of input: no).
const confirm = (question: string) =>
  new Promise<boolean>((done) => {
    process.stderr.write(question)
    const lines = createInterface({ input: process.stdin })
    lines.once("line", (answer) => {
      lines.close()
      done(/^[yY]/.test(answer))
    })
    lines.once("close", () => done(false))
  })

const traced = (log: string) => async (argv: string[], o?: RunOptions) => {
  const result = await run(argv, o)
  const time = new Date().toTimeString().slice(0, 8)
  appendFileSync(log, `${time} ${JSON.stringify(argv)}${result.ok ? "" : ` failed: ${result.stderr.trim()}`}\n`)
  return result
}

// The caller's folder. When it is gone (ade worktree rm run from inside the
// worktree it removes), its path still resolves the arguments, and the commands ade runs
// start in the home folder.
const callerFolder = () => {
  try {
    return process.cwd()
  } catch {
    process.chdir(homedir())
    return process.env.PWD?.startsWith("/") ? process.env.PWD : homedir()
  }
}

async function main(command: string | undefined, args: string[]) {
  const env = process.env
  const kit = () => makeKit({ env, ...(env.ADE_LOG ? { run: traced(env.ADE_LOG) } : {}) })
  const caller = { env, cwd: callerFolder() }
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
    case "restart-agent":
      if (args.length > 1) throw new UsageError()
      return restartAgent(kit(), args[0] ?? caller.cwd, caller)
    case "forget-gone":
      if (args.length) throw new UsageError()
      for (const dir of await forgetGone(kit(), caller)) process.stdout.write(`${dir}\n`)
      return
    case "where":
      if (args.length) throw new UsageError()
      process.stdout.write(`${await where(kit(), caller)}\n`)
      return
    case "worktree": {
      const io = {
        ...caller,
        say,
        out: (text: string) => void process.stdout.write(text),
        passthrough: true,
        ...(process.stdin.isTTY ? { confirm } : {}),
      }
      process.exitCode = await worktreeCommand(kit(), args, io)
      return
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
