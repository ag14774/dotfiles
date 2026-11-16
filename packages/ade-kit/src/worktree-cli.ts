// `ade worktree`: create, open, list and remove worktrees. stdout carries
// only the result (a worktree's path, or the list); messages go through
// io.say. A process can't change its caller's folder, so with --cwd-file the
// folder to change to is written there instead (a shell function then cds).
import { writeFileSync } from "node:fs"
import type { Kit } from "./types.ts"
import { Failed } from "./git.ts"
import type { Io, Landed } from "./worktrees.ts"
import { clone, convert, list, open, prune, remove } from "./worktrees.ts"

export type CommandIo = Io & { out(text: string): void }

export const USAGE = `usage: ade worktree [--cwd-file FILE] <command> [args]

commands:
  clone <url> [dir]         clone a repository into dir (default: its name), laid
                            out for worktrees.layout (bare: the repository in
                            dir/.bare, with no worktree yet)
  open [LAND] <branch> [base]
                            the worktree of <branch>; if there is none, make it
                            where the repository's layout puts it (a local branch
                            as it is, a branch on origin tracking it, else a new
                            branch from base, default worktrees.base) and copy
                            the seed files into it
  rm [-f] <name>            remove the worktree of a branch, folder name or path
                            (-f: even with uncommitted changes), close its
                            tabs, except yours (none when an agent runs it),
                            and let the agent forget it (ade forget-gone)
  ls [--json]               list the worktrees; --json: each one's branch,
                            changed files, commits ahead of and behind
                            worktrees.base, and whether it has a tab
  prune [-y] [-n] [-m]      remove the worktrees whose remote branch was deleted
                            (-m: also those merged through a GitHub PR; needs
                            gh), never the one you are in or the default
                            branch's; fetches first (-n: doesn't), lists them
                            and asks (-y: doesn't)
  convert [-y]              turn the normal clone you are in into the
                            configured layout; shows what it will do and asks
                            first (-y: doesn't)
  help                      show this help

LAND (open): what happens once the worktree exists:
  (none)                    go there: print its path (with --cwd-file, write it
                            to that file instead, for a shell function to cd)
  -s, --stay                stay where you are: print its path
  -t, --tab                 go to its tab, opening one if it has none
  -b, --background          open its tab without going to it
  -p, --prompt PROMPT       open a tab in the background whose agent starts on
                            PROMPT (fails if the worktree already has a tab)
  --session ID              like -p, with the agent showing conversation ID
                            (with or without a prompt)
  A worktree's tab is a tab whose panes are all inside the worktree.
  Outside a multiplexer, -t goes there instead (as without LAND), -b stays,
  and -p fails.

prune/convert without -y need a terminal to confirm and fail otherwise.

output:
  stdout                    only the result: the worktree path for open and
                            convert, the list for ls, or this help
  stderr                    progress, prompts and errors
  exit status               0 on success; non-zero on failure (nothing on stdout)

--cwd-file FILE   write the directory to cd into to FILE instead of stdout

seeds (untracked files copied into new worktrees), the first that is set:
  ADE_SEED_FILE             a manifest: one relative path or glob per line
  <common-dir>/ade-seed     the repository's manifest, same format
  ADE_SEED                  newline-separated patterns
  worktrees.seed            the ADE config's list (.env, .env.*, .envrc,
                            pyrightconfig.json)`

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
