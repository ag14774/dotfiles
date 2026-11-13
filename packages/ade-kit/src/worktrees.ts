// Worktrees: what the wt shell functions (shell/worktree.zsh) do, through
// `ade worktree` (worktree-cli.ts), and in-process for the OpenCode plugin.
// Messages are the wt commands' own ("wt: ..."). Nothing here changes the
// process's folder or reads its environment: both come with the Io.
import { spawn } from "node:child_process"
import { tabs } from "./actions.ts"
import { loadMultiplexer } from "./load.ts"
import type { Kit, MultiplexerAdapter, Where } from "./types.ts"
import { isDirectory } from "./workspace.ts"

type Env = Record<string, string | undefined>

// Where a command runs, and how it talks to you.
export type Io = {
  env: Env
  cwd: string
  say(line: string): void // a message (the CLI: stderr)
  // Git's own output (progress, "Preparing worktree ..."): straight to stderr
  // as it runs (the CLI), or else line by line through say.
  passthrough: boolean
  // A yes/no question; absent when there is no terminal to ask in.
  confirm?(question: string): Promise<boolean>
}

// A command failed; its message (if any) is the line to show. Git's own error
// has been shown already when the message is empty.
export class Failed extends Error {}

// A git query: its output, or undefined when it fails. No timeout: a status
// in a big repository can be slow.
export async function query(kit: Kit, io: Io, args: string[], cwd = io.cwd) {
  const result = await kit.run(["git", ...args], { cwd, env: io.env, timeout: 0 })
  return result.ok ? result.stdout : undefined
}
const line = (text: string | undefined) => text?.replace(/\n$/, "")

// A git command whose own output you see. Never on stdout: callers capture
// `wt -s`'s path, and a background job git starts must not hold it open.
export async function loud(kit: Kit, io: Io, args: string[], cwd = io.cwd): Promise<boolean> {
  if (io.passthrough)
    return new Promise((done) => {
      const child = spawn("git", args, { cwd, env: io.env as NodeJS.ProcessEnv, stdio: ["inherit", 2, 2] })
      child.on("error", () => done(false))
      child.on("close", (code) => done(code === 0))
    })
  const result = await kit.run(["git", ...args], { cwd, env: io.env, timeout: 0 })
  for (const text of `${result.stdout}${result.stderr}`.split("\n")) if (text) io.say(text)
  return result.ok
}

// The repository the caller is in: its Git common folder (.bare, .git), and
// the folder its worktrees go in (the common folder's parent: the project in
// the bare layout, the clone itself otherwise).
export type Repository = { common: string; root: string }
export async function repositoryOf(kit: Kit, io: Io, cwd = io.cwd): Promise<Repository | undefined> {
  const common = line(await query(kit, io, ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd))
  return common ? { common, root: common.replace(/\/[^/]+$/, "") || "/" } : undefined
}

// `git worktree list --porcelain`, record by record.
export type WorktreeRecord = { path: string; branch?: string; bare: boolean }
export function records(porcelain: string): WorktreeRecord[] {
  const found: WorktreeRecord[] = []
  for (const record of porcelain.split("\n")) {
    if (record.startsWith("worktree ")) found.push({ path: record.slice(9), bare: false })
    else if (record.startsWith("branch refs/heads/") && found.length) found[found.length - 1].branch = record.slice(18)
    else if (record === "bare" && found.length) found[found.length - 1].bare = true
  }
  return found
}
export const worktreeRecords = async (kit: Kit, io: Io, cwd: string, ...gitDir: string[]) =>
  records((await query(kit, io, [...gitDir, "worktree", "list", "--porcelain"], cwd)) ?? "")

// The caller's multiplexer session when it runs inside the configured one;
// otherwise why not ("not inside Zellij", or none configured).
export async function multiplexerOf(kit: Kit, env: Env): Promise<{ adapter?: MultiplexerAdapter; where?: Where; why: string }> {
  const adapter = await loadMultiplexer(kit)
  if (!adapter) return { why: "no multiplexer is configured" }
  const label = adapter.label ?? adapter.name
  const where = adapter.here(env)
  return where ? { adapter, where, why: "" } : { adapter, why: `not inside ${label}` }
}

export type Listed = {
  path: string
  branch: string | null
  changed: number // files with uncommitted changes
  ahead: number | null // commits relative to origin/HEAD (null without it)
  behind: number | null
  tab: "sure" | "unsure" | null // see tabsIn; null outside a multiplexer
}

// The repository's worktrees (no bare repository, no folder deleted by hand),
// for `wtls --json` and the plugin's status.
export async function list(kit: Kit, io: Io): Promise<Listed[]> {
  if ((await query(kit, io, ["rev-parse", "--git-dir"])) === undefined) throw new Failed("wtls: not inside a git repo")
  const base = line(await query(kit, io, ["rev-parse", "--verify", "--quiet", "origin/HEAD"]))
  const found = (await worktreeRecords(kit, io, io.cwd)).filter((r) => !r.bare && isDirectory(r.path))
  const paths = found.map((r) => r.path)
  let tabsOf: Record<string, { sure: boolean }[]> = {}
  if (paths.length && (await multiplexerOf(kit, io.env).catch(() => undefined))?.where)
    tabsOf = await tabs(kit, paths, { env: io.env, cwd: io.cwd }).catch(() => ({}))
  return Promise.all(
    found.map(async ({ path, branch }) => {
      const counts = base ? line(await query(kit, io, ["rev-list", "--left-right", "--count", `${base}...HEAD`], path)) : undefined
      const [behind, ahead] = counts ? counts.split("\t").map(Number) : [null, null]
      const status = (await query(kit, io, ["status", "--porcelain"], path)) ?? ""
      const first = tabsOf[path]?.[0]
      return {
        path,
        branch: branch || null,
        changed: status.split("\n").length - 1,
        ahead,
        behind,
        tab: first ? (first.sure ? "sure" : "unsure") : null,
      } satisfies Listed
    }),
  )
}
