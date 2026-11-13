// `ade worktree`: the engine behind the wt shell functions (shell/worktree.zsh),
// with wt-core's arguments, results and messages. stdout carries only the
// result (a worktree's path, or the list); messages go through io.say. A
// process can't change its caller's folder, so with --cwd-file the folder to
// change to is written there instead (the shell function then cds).
import type { Kit } from "./types.ts"
import type { Io } from "./worktrees.ts"
import { Failed, list } from "./worktrees.ts"

export type CommandIo = Io & { out(text: string): void }

export const USAGE = `usage: ade worktree [--cwd-file FILE] <command> [args]

commands (interactive shell equivalent in parentheses):
  ls [--json]               list worktrees (wtls); --json for programs
  help                      show this help

output:
  stdout                    only the result: the list for ls, or this help
  stderr                    progress, prompts and errors
  exit status               0 on success; non-zero on failure (nothing on stdout)

--cwd-file FILE   write the directory to cd into to FILE instead of stdout`

async function ls(kit: Kit, args: string[], io: CommandIo) {
  if (args[0] !== "--json") {
    const result = await kit.run(["git", "worktree", "list"], { cwd: io.cwd, env: io.env, timeout: 0 })
    io.out(result.stdout)
    if (result.stderr) for (const text of result.stderr.replace(/\n$/, "").split("\n")) io.say(text)
    return result.ok ? 0 : 1
  }
  io.out(`${JSON.stringify(await list(kit, io))}\n`)
  return 0
}

// Run `ade worktree ARGS`; the exit status.
export async function worktreeCommand(kit: Kit, argv: string[], io: CommandIo): Promise<number> {
  let args = argv
  if (args[0] === "--cwd-file") {
    if (args.length < 2) {
      io.say("ade worktree: --cwd-file needs a path")
      return 2
    }
    args = args.slice(2)
  }
  const [command = "help", ...rest] = args
  try {
    switch (command) {
      case "ls":
        return await ls(kit, rest, io)
      case "help":
      case "-h":
      case "--help":
        io.out(`${USAGE}\n`)
        return 0
      default:
        io.say(`ade worktree: unknown command '${command}' (see: ade worktree help)`)
        return 2
    }
  } catch (error) {
    if (!(error instanceof Failed)) throw error
    if (error.message) io.say(error.message)
    return 1
  }
}
