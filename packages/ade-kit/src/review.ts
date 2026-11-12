// What a review covers (see Scope in types.ts), and how a reviewer runs.
import type { Kit, Reviewer, Scope } from "./types.ts"

export async function scopeOf(kit: Kit, dir: string): Promise<Scope> {
  const git = async (...args: string[]) => {
    const result = await kit.run(["git", "-C", dir, ...args])
    return result.ok ? result.stdout.trim() : ""
  }
  const [head, base, changes] = await Promise.all([
    git("rev-parse", "--verify", "--quiet", "HEAD"),
    git("merge-base", "origin/HEAD", "HEAD"),
    git("status", "--porcelain"),
  ])
  return { dir, ...(base ? { base } : {}), commits: base !== "" && base !== head, uncommitted: changes !== "" }
}

// The scope as `ade review --scope` prints it, in tuicr's notation: -r
// BASE..HEAD for the commits, -w for uncommitted changes.
export const scopeWords = (scope: Scope) => [
  ...(scope.commits ? [`-r ${scope.base}..HEAD`] : []),
  ...(scope.uncommitted ? ["-w"] : []),
]

// A word for a POSIX shell, or for tools that split commands the same way.
const shellWord = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`

// The reviewer's environment: its "open this file" key runs `ade open` (the
// command at `ade`).
export const reviewerEnv = (reviewer: Reviewer, env: Record<string, string | undefined>, ade: string) =>
  reviewer.editorVariable ? { ...env, [reviewer.editorVariable]: `${shellWord(ade)} open` } : { ...env }
