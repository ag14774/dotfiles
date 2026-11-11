// Where am I: the workspace (the Git worktree the caller works in, with or
// without a multiplexer), and the multiplexer location when there is one.
import { createHash } from "node:crypto"
import { statSync } from "node:fs"
import type { LoadOptions } from "./load.ts"
import { loadMultiplexer } from "./load.ts"
import { callerDir } from "./multiplexer.ts"
import type { Kit, Multiplexer, MultiplexerAdapter, Where, Workspace } from "./types.ts"

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

export type Located = { adapter: MultiplexerAdapter; where: Where; mux: Multiplexer }

// The caller's multiplexer location, when it runs inside the configured one.
export async function located(kit: Kit, env: Env = process.env, o: LoadOptions = {}): Promise<Located | undefined> {
  const adapter = await loadMultiplexer(kit, o)
  const where = adapter?.here(env)
  return adapter && where ? { adapter, where, mux: adapter.connect(where) } : undefined
}

const isDirectory = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false

// The caller's workspace: that of the pane you were in (see callerDir) when
// inside a multiplexer, else that of `cwd`.
export async function callerWorkspace(kit: Kit, cwd: string, env: Env = process.env, o: LoadOptions = {}) {
  const at = await located(kit, env, o)
  const dir = at ? callerDir(await at.mux.panes(), at.where) : undefined
  return workspaceOf(kit, dir && isDirectory(dir) ? dir : cwd)
}
