// Running git for the worktree commands and layouts (Kit's git).
import { spawn } from "node:child_process"
import { resolve } from "node:path"
import type { Kit, WorktreeIo as Io, WorktreeRecord } from "./types.ts"

type Runs = Pick<Kit, "run">

// A command failed; its message (if any) is the line to show. Git's own error
// has been shown already when the message is empty.
export class Failed extends Error {}

// Folders are relative to the command's (io.cwd).

// A git query: its output, or undefined when it fails. In English, as it is
// parsed ("[gone]"). No timeout: a status in a big repository can be slow.
export async function query(kit: Runs, io: Io, args: string[], cwd = io.cwd) {
  const result = await kit.run(["git", ...args], { cwd: resolve(io.cwd, cwd), env: { ...io.env, LC_ALL: "C" }, timeout: 0 })
  return result.ok ? result.stdout : undefined
}
export const line = (text: string | undefined) => text?.replace(/\n$/, "")

// A git command whose own output you see. Never on stdout: callers capture
// `open -s`'s path, and a background job git starts must not hold it open.
export async function loud(kit: Runs, io: Io, args: string[], cwd = io.cwd): Promise<boolean> {
  if (io.passthrough)
    return new Promise((done) => {
      const child = spawn("git", args, { cwd: resolve(io.cwd, cwd), env: io.env as NodeJS.ProcessEnv, stdio: ["inherit", 2, 2] })
      child.on("error", () => done(false))
      child.on("close", (code) => done(code === 0))
    })
  const result = await kit.run(["git", ...args], { cwd: resolve(io.cwd, cwd), env: io.env, timeout: 0 })
  for (const text of `${result.stdout}${result.stderr}`.split("\n")) if (text) io.say(text)
  return result.ok
}

// `git worktree list --porcelain`, record by record.
export function records(porcelain: string): WorktreeRecord[] {
  const found: WorktreeRecord[] = []
  for (const record of porcelain.split("\n")) {
    if (record.startsWith("worktree ")) found.push({ path: record.slice(9), bare: false })
    else if (record.startsWith("branch refs/heads/") && found.length) found[found.length - 1].branch = record.slice(18)
    else if (record === "bare" && found.length) found[found.length - 1].bare = true
  }
  return found
}
export const worktreeRecords = async (kit: Runs, io: Io, cwd: string, ...gitDir: string[]) =>
  records((await query(kit, io, [...gitDir, "worktree", "list", "--porcelain"], cwd)) ?? "")

// What Kit's git gives adapters.
export const gitFor = (kit: Runs): Kit["git"] => ({
  query: (io, args, cwd) => query(kit, io, args, cwd),
  value: async (io, args, cwd) => line(await query(kit, io, args, cwd)),
  loud: (io, args, cwd) => loud(kit, io, args, cwd),
  worktrees: (io, cwd, ...gitDir) => worktreeRecords(kit, io, cwd, ...gitDir),
})
