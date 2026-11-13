// Worktrees next to a normal clone: ~/code/repo.feat-x beside ~/code/repo
// (worktrunk's default). In a bare repository, as in the bare layout:
// <project>/<branch>.
import { basename, dirname, join } from "node:path"
import type { Layout } from "../types.ts"

export default (): Layout => ({
  api: 1,
  name: "sibling",
  path: (repo, name) => (repo.bare ? join(repo.root, name) : join(dirname(repo.root), `${basename(repo.root)}.${name}`)),
})
