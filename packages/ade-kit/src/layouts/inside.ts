// Worktrees in a hidden folder of a normal clone: repo/.worktrees/feat-x,
// kept out of git status through the repository's info/exclude. In a bare
// repository, as in the bare layout: <project>/<branch>.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Layout } from "../types.ts"

const EXCLUDE = "/.worktrees/"

export default (): Layout => ({
  api: 1,
  name: "inside",
  path: (repo, name) => (repo.bare ? join(repo.root, name) : join(repo.root, ".worktrees", name)),
  prepare: async (repo) => {
    if (repo.bare) return
    const file = join(repo.common, "info", "exclude")
    let text = ""
    try {
      text = readFileSync(file, "utf8")
    } catch {
      mkdirSync(join(repo.common, "info"), { recursive: true })
    }
    if (!text.split("\n").includes(EXCLUDE)) appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}${EXCLUDE}\n`)
  },
})
