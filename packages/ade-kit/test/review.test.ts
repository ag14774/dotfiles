import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DEFAULTS } from "../src/config.ts"
import { makeKit } from "../src/kit.ts"
import { reviewerEnv, scopeOf, scopeWords } from "../src/review.ts"
import tuicr from "../src/reviewers/tuicr.ts"

const kit = makeKit({ config: DEFAULTS })
const temp = realpathSync(mkdtempSync(join(tmpdir(), "ade-review-")))
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim()

// A clone of a repository with one commit on main, and one without a remote.
git(temp, "init", "-q", "--bare", "origin.git")
git(temp, "init", "-q", "-b", "main", "seed")
writeFileSync(join(temp, "seed", "a.txt"), "one\n")
git(join(temp, "seed"), "add", "a.txt")
git(join(temp, "seed"), "commit", "-qm", "base")
git(join(temp, "seed"), "push", "-q", join(temp, "origin.git"), "main")
git(temp, "clone", "-q", join(temp, "origin.git"), "work")
const work = join(temp, "work")
const base = git(work, "rev-parse", "HEAD")

test("the scope: commits since the merge base with origin/HEAD, and uncommitted changes", async () => {
  assert.deepEqual(await scopeOf(kit, work), { dir: work, base, commits: false, uncommitted: false })
  git(work, "switch", "-qc", "agent")
  writeFileSync(join(work, "a.txt"), "one\ntwo\n")
  git(work, "commit", "-qam", "agent work")
  assert.deepEqual(await scopeOf(kit, work), { dir: work, base, commits: true, uncommitted: false })
  writeFileSync(join(work, "b.txt"), "new\n")
  assert.deepEqual(await scopeOf(kit, work), { dir: work, base, commits: true, uncommitted: true })
  // A wtreview worktree: HEAD at the merge base, the PR staged.
  git(work, "add", "b.txt")
  git(work, "switch", "-q", "--detach")
  git(work, "reset", "-q", "--soft", base)
  assert.deepEqual(await scopeOf(kit, work), { dir: work, base, commits: false, uncommitted: true })
  const local = join(temp, "local")
  mkdirSync(local)
  git(local, "init", "-q")
  assert.deepEqual(await scopeOf(kit, local), { dir: local, commits: false, uncommitted: false })
})

test("the scope in words, as ade review --scope prints it", () => {
  assert.deepEqual(scopeWords({ dir: "/w", base: "abc", commits: true, uncommitted: true }), ["-r abc..HEAD", "-w"])
  assert.deepEqual(scopeWords({ dir: "/w", base: "abc", commits: false, uncommitted: true }), ["-w"])
  assert.deepEqual(scopeWords({ dir: "/w", commits: false, uncommitted: false }), [])
})

test("tuicr: the commits as a range, -w for uncommitted changes, comments on stdout", () => {
  const command = tuicr().command
  assert.deepEqual(command({ dir: "/w", base: "abc", commits: true, uncommitted: true }), ["tuicr", "-r", "abc..HEAD", "-w", "--stdout"])
  assert.deepEqual(command({ dir: "/w", base: "abc", commits: true, uncommitted: false }), ["tuicr", "-r", "abc..HEAD", "--stdout"])
  assert.deepEqual(command({ dir: "/w", base: "abc", commits: false, uncommitted: true }), ["tuicr", "-w", "--stdout"])
})

test("the reviewer's editor variable runs ade open, quoted as a shell word", () => {
  const env = reviewerEnv(tuicr(), { PATH: "/bin", EDITOR: "vi" }, "/home/me/it's here/cli.ts")
  assert.deepEqual(env, { PATH: "/bin", EDITOR: `'/home/me/it'\\''s here/cli.ts' open` })
  assert.deepEqual(reviewerEnv({ ...tuicr(), editorVariable: undefined }, { EDITOR: "vi" }, "/a"), { EDITOR: "vi" })
})
