// OpenCode's worktree strategy (create, remove, list) on ade-kit's worktree
// commands. OpenCode suggests a folder <parent>/<name>, its parent being
// <data>/opencode/worktree/<the project ID's first 6 characters> unless its
// config's worktree.directory says otherwise; the name is the one you typed
// (or a random one), so the worktree is `wt -s NAME [START]` from the
// checkout OpenCode starts from. Its `branch` is the ref to start from.
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative } from "node:path"
import { readConfig } from "../../ade-kit/src/config.ts"
import { makeKit } from "../../ade-kit/src/kit.ts"
import { isDirectory } from "../../ade-kit/src/workspace.ts"
import { Failed, open, remove, worktreeRecords } from "../../ade-kit/src/worktrees.ts"

type Env = Record<string, string | undefined>
export type StrategyOptions = {
  env: Env
  projectID: string
  // The error that asks OpenCode to confirm a forced removal.
  forceRequired(message: string): Error
}

export type Strategy = {
  id: string
  create(input: { sourceDirectory: string; directory: string; branch?: string }): Promise<{ directory: string }>
  remove(input: { directory: string; force: boolean }): Promise<void>
  list(sourceDirectory: string): Promise<{ directory: string; type: "root" | "worktree" }[]>
}

// The name in OpenCode's suggested folder: the part below its default parent
// (so feat/x stays feat/x), else the folder's own name.
export function nameIn(directory: string, env: Env, projectID: string) {
  const data = env.XDG_DATA_HOME?.startsWith("/") ? env.XDG_DATA_HOME : join(env.HOME || homedir(), ".local", "share")
  const rel = relative(join(data, "opencode", "worktree", projectID.slice(0, 6)), directory)
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : basename(directory)
}

// Registered under OpenCode's name for its own Git strategy, so that
// worktrees it recorded with that owner (every folder a conversation opened
// in) are removed through this one too.
export function strategy(o: StrategyOptions): Strategy {
  // OpenCode's service has no multiplexer of its own (it may have inherited
  // a pane's variables): no tabs are opened or closed from here.
  const kit = () => makeKit({ env: o.env, config: { ...readConfig(o.env), multiplexer: "none" } })
  const io = (cwd: string, said: string[]) => ({ env: o.env, cwd, say: (line: string) => void said.push(line), passthrough: false })
  const why = (said: string[], error: Failed) => [...said, error.message].filter(Boolean).join("\n")
  return {
    id: "git",
    create: async ({ directory, sourceDirectory, branch }) => {
      const said: string[] = []
      const args = ["-s", "--", nameIn(directory, o.env, o.projectID), ...(branch ? [branch] : [])]
      try {
        return { directory: (await open(kit(), io(sourceDirectory, said), args)).dir }
      } catch (error) {
        throw error instanceof Failed ? new Error(why(said, error)) : error
      }
    },
    remove: async ({ directory, force }) => {
      const said: string[] = []
      try {
        const cwd = isDirectory(directory) ? directory : dirname(directory)
        await remove(kit(), io(cwd, said), [...(force ? ["-f"] : []), directory])
      } catch (error) {
        if (!(error instanceof Failed)) throw error
        const message = why(said, error)
        throw /modified or untracked files|use --force|is dirty/i.test(message) ? o.forceRequired(message) : new Error(message)
      }
    },
    // The repository's worktrees; the first one git lists (the main checkout,
    // or the bare repository) is its root.
    list: async (sourceDirectory) => {
      const found = await worktreeRecords(kit(), io(sourceDirectory, []), sourceDirectory)
      return found
        .map((r, i) => ({ directory: r.path, type: i === 0 ? ("root" as const) : ("worktree" as const) }))
        .filter((r) => isDirectory(r.directory))
    },
  }
}
