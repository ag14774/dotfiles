// Where am I: the workspace (the Git worktree the caller works in, with or
// without a multiplexer), and the multiplexer location when there is one.
import { createHash } from "node:crypto"
import { realpathSync, statSync } from "node:fs"
import type { LoadOptions } from "./load.ts"
import { loadMultiplexer } from "./load.ts"
import { callerDir } from "./multiplexer.ts"
import type { Kit, Multiplexer, MultiplexerAdapter, Pane, Where, Workspace } from "./types.ts"

type Env = Record<string, string | undefined>

// The name for a workspace's remote-controlled programs (a Kakoune session, a
// socket), derived from its path so that nothing has to be remembered.
export const sessionOf = (dir: string) => `ade-${createHash("sha1").update(dir).digest("hex").slice(0, 8)}`

// The Git worktree containing `dir`.
export async function workspaceOf(kit: Kit, dir: string): Promise<Workspace | undefined> {
  const result = await kit.run(["git", "-C", dir, "rev-parse", "--show-toplevel"])
  const top = result.stdout.trim()
  return result.ok && top ? { dir: top, session: sessionOf(top) } : undefined
}

// The worktrees of the repository `dir` is in (none outside one), as real
// paths.
export async function worktreesOf(kit: Kit, dir: string): Promise<string[]> {
  const result = await kit.run(["git", "-C", dir, "worktree", "list", "--porcelain"])
  if (!result.ok) return []
  return result.stdout
    .split(/\n\n+/)
    .map((record) => record.split("\n"))
    .filter((lines) => !lines.includes("bare"))
    .flatMap((lines) => lines.filter((line) => line.startsWith("worktree ")).map((line) => realPath(line.slice(9))))
}

// The path with its symbolic links resolved; as it is if it doesn't exist.
export function realPath(path: string) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

export type Located = { adapter: MultiplexerAdapter; where: Required<Where>; mux: Multiplexer }

// The caller's multiplexer location, when it runs in a pane of the configured
// one.
export async function located(kit: Kit, env: Env = process.env, o: LoadOptions = {}): Promise<Located | undefined> {
  const adapter = await loadMultiplexer(kit, o)
  const where = adapter?.here(env)
  if (!adapter || where?.pane === undefined) return undefined
  return { adapter, where: { session: where.session, pane: where.pane }, mux: adapter.connect(where) }
}

export const isDirectory = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false

// The folder the caller works in: that of the pane you were in (see
// callerDir), when it is known and still exists, else `cwd`.
export function callerFolder(panes: readonly Pane[] | undefined, where: Where | undefined, cwd: string) {
  const dir = panes && where ? callerDir(panes, where) : undefined
  return dir && isDirectory(dir) ? dir : cwd
}

// The caller's workspace: that of the pane you were in (see callerDir) when
// inside a multiplexer, else that of `cwd`.
export async function callerWorkspace(kit: Kit, cwd: string, env: Env = process.env, o: LoadOptions = {}) {
  const at = await located(kit, env, o)
  return workspaceOf(kit, callerFolder(at && (await at.mux.panes()), at?.where, cwd))
}
