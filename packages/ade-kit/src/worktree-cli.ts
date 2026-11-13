// `ade worktree`: the engine behind the wt shell functions (shell/worktree.zsh),
// with wt-core's arguments, results and messages. stdout carries only the
// result (a worktree's path, or the list); messages go through io.say. A
// process can't change its caller's folder, so with --cwd-file the folder to
// change to is written there instead (the shell function then cds).
import { writeFileSync } from "node:fs"
import type { Kit } from "./types.ts"
import type { Io } from "./worktrees.ts"
import type { Landed } from "./worktrees.ts"
import { clone, convert, Failed, list, open, prune, remove } from "./worktrees.ts"

export type CommandIo = Io & { out(text: string): void }

export const USAGE = `usage: ade worktree [--cwd-file FILE] <command> [args]

commands (interactive shell equivalent in parentheses):
  clone <url> [dir]         clone a repo laid out for worktrees (wtclone)
  open [LAND] <branch> [base]
                            create/reuse the worktree for <branch> (wt)
  rm [-f] <name>            remove a worktree by branch or directory, closing
                            its tabs, except the tab of the caller (wtrm)
  ls [--json]               list worktrees (wtls); --json for programs
  prune [-y] [-n] [-m]      remove deleted-remote/merged worktrees (wtprune)
  convert [-y]              convert the normal clone in CWD to the configured
                            layout (wtconvert)
  help                      show this help

LAND (open) chooses what happens after the worktree exists:
  (none)                    report it as the result (the wt functions cd there)
  -s, --stay                report it as the result
  -t, --tab                 focus its tab, opening one if needed
  -b, --background          open its tab without moving focus
  -p, --prompt PROMPT       start the agent in a new tab with PROMPT (implies -b;
                            fails if the worktree already has a tab)
  --session ID              like -p, on the agent's conversation ID (with or
                            without a prompt)
  The tab of a worktree is any tab whose panes are all inside the worktree.
  Outside a multiplexer, -t and -b fall back to changing directory and staying;
  -p fails.

prune/convert without -y need a terminal to confirm and fail otherwise.

output:
  stdout                    only the result: the worktree path for open and
                            convert, the list for ls, or this help
  stderr                    progress, prompts and errors
  exit status               0 on success; non-zero on failure (nothing on stdout)

--cwd-file FILE   write the directory to cd into to FILE instead of stdout
WT_SEED           newline-separated seed patterns replacing the defaults (a
                  WT_SEED array in ~/.zshrc reaches only the wt functions; a
                  repo's <common-dir>/wt-seed manifest applies to every caller)
WT_SEED_FILE      explicit seed manifest (see \`wthelp\` in an interactive shell)`

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
  let cwdFile: string | undefined
  if (args[0] === "--cwd-file") {
    if (args.length < 2) {
      io.say("ade worktree: --cwd-file needs a path")
      return 2
    }
    cwdFile = args[1]
    args = args.slice(2)
  }
  const [command = "help", ...rest] = args
  // Report the folder, or write it to the cwd file for the shell to cd to.
  const report = ({ dir, cd }: Landed) => {
    if (cd && cwdFile !== undefined) writeFileSync(cwdFile, `${dir}\n`)
    else io.out(`${dir}\n`)
    return 0
  }
  try {
    switch (command) {
      case "clone":
        await clone(kit, io, rest)
        return 0
      case "open":
        return report(await open(kit, io, rest))
      case "rm":
        await remove(kit, io, rest)
        return 0
      case "ls":
        return await ls(kit, rest, io)
      case "prune":
        await prune(kit, io, rest)
        return 0
      case "convert":
        return report(await convert(kit, io, rest))
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
