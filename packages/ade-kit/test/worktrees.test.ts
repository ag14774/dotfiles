import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DEFAULTS } from "../src/config.ts"
import { makeKit, run } from "../src/kit.ts"
import type { Config, Kit, Pane } from "../src/types.ts"
import { worktreeCommand } from "../src/worktree-cli.ts"
import type { Io } from "../src/worktrees.ts"
import { Failed, list, records, repositoryOf } from "../src/worktrees.ts"

const temp = realpathSync(mkdtempSync(join(tmpdir(), "ade-worktrees-")))
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })

// An origin with one commit, and a clone of it in the bare layout with a
// worktree for main.
const origin = join(temp, "origin")
mkdirSync(origin)
git(origin, "init", "-q", "-b", "main")
git(origin, "commit", "-q", "--allow-empty", "-m", "base")
const project = join(temp, "project")
git(temp, "clone", "-q", "--bare", origin, join(project, ".bare"))
writeFileSync(join(project, ".git"), "gitdir: ./.bare\n")
git(project, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*")
git(project, "fetch", "-q", "origin")
git(project, "remote", "set-head", "origin", "--auto")
git(project, "worktree", "add", "-q", "main", "main")

// Panes of a multiplexer of your own: tab 1 works in feat, tab 2 too but one
// of its panes doesn't say where it is.
const panes = (feat: string, detached: string): Pane[] => [
  { id: "1", tab: "1", cwd: feat, running: true, floating: false, focused: true },
  { id: "2", tab: "2", cwd: detached, running: true, floating: false, focused: false },
  { id: "3", tab: "2", running: true, floating: false, focused: false },
]
const fake = join(temp, "fake.ts")
const kitWith = (multiplexer = "none"): Kit => makeKit({ config: { ...structuredClone(DEFAULTS), multiplexer } as Config, run })

const ioIn = (cwd: string, env: Record<string, string | undefined> = {}) => {
  const said: string[] = []
  let out = ""
  const io: Io & { out(text: string): void } = {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    cwd,
    say: (line) => void said.push(line),
    out: (text) => void (out += text),
    passthrough: false,
  }
  return { io, said, output: () => out }
}

test("records: git's porcelain list, with branches and the bare repository", () => {
  const porcelain = "worktree /p/.bare\nbare\n\nworktree /p/main\nHEAD abc\nbranch refs/heads/main\n\nworktree /p/x\nHEAD def\ndetached\n"
  assert.deepEqual(records(porcelain), [
    { path: "/p/.bare", bare: true },
    { path: "/p/main", branch: "main", bare: false },
    { path: "/p/x", bare: false },
  ])
})

test("repositoryOf: the common folder, and the folder worktrees go in", async () => {
  assert.deepEqual(await repositoryOf(kitWith(), ioIn(join(project, "main")).io), { common: join(project, ".bare"), root: project })
  assert.equal(await repositoryOf(kitWith(), ioIn(temp).io), undefined)
})

test("list: each worktree's branch, changes, commits and tab", async () => {
  git(project, "worktree", "add", "-q", "-b", "feat", "feat", "main")
  git(join(project, "feat"), "commit", "-q", "--allow-empty", "-m", "work")
  writeFileSync(join(project, "feat", "notes.md"), "new\n")
  git(project, "worktree", "add", "-q", "--detach", "detached", "main")
  git(project, "worktree", "add", "-q", "-b", "gone", "gone", "main")
  rmSync(join(project, "gone"), { recursive: true }) // deleted by hand: not listed
  writeFileSync(
    fake,
    `export default () => ({
      api: 1, name: "fake",
      here: (env) => (env.FAKE ? { session: "s" } : undefined),
      connect: () => ({ panes: async () => ${JSON.stringify(panes(join(project, "feat"), join(project, "detached")))},
        tabs: async () => [], start: async () => "", type: async () => {}, paste: async () => {}, focus: async () => {} }),
    })`,
  )
  const entry = (path: string, branch: string | null, changed: number, ahead: number, tab: string | null) =>
    ({ path: join(project, path), branch, changed, ahead, behind: 0, tab })
  assert.deepEqual(await list(kitWith(fake), ioIn(join(project, "main"), { FAKE: "1" }).io), [
    entry("detached", null, 0, 0, "unsure"),
    entry("feat", "feat", 1, 1, "sure"),
    entry("main", "main", 0, 0, null),
  ])
  // Outside the multiplexer, no tabs.
  assert.deepEqual((await list(kitWith(fake), ioIn(join(project, "main")).io)).map((w) => w.tab), [null, null, null])
  // Without origin/HEAD, no counts.
  const local = join(temp, "local")
  mkdirSync(local)
  git(local, "init", "-q", "-b", "main")
  git(local, "commit", "-q", "--allow-empty", "-m", "one")
  assert.deepEqual(await list(kitWith(), ioIn(local).io), [{ path: local, branch: "main", changed: 0, ahead: null, behind: null, tab: null }])
  await assert.rejects(list(kitWith(), ioIn(temp).io), new Failed("wtls: not inside a git repo"))
})

test("ade worktree: ls, its exit statuses and messages", async () => {
  const main = join(project, "main")
  let r = ioIn(main)
  assert.equal(await worktreeCommand(kitWith(), ["ls", "--json"], r.io), 0)
  assert.deepEqual(
    JSON.parse(r.output()).map((w: { path: string }) => w.path),
    ["detached", "feat", "main"].map((p) => join(project, p)),
  )
  r = ioIn(main)
  assert.equal(await worktreeCommand(kitWith(), ["--cwd-file", "/dev/null", "ls"], r.io), 0)
  assert.equal(r.output(), git(main, "worktree", "list"))
  r = ioIn(temp)
  assert.equal(await worktreeCommand(kitWith(), ["ls", "--json"], r.io), 1)
  assert.deepEqual([r.output(), r.said], ["", ["wtls: not inside a git repo"]])
  r = ioIn(main)
  assert.equal(await worktreeCommand(kitWith(), ["bogus"], r.io), 2)
  assert.deepEqual(r.said, ["ade worktree: unknown command 'bogus' (see: ade worktree help)"])
  r = ioIn(main)
  assert.equal(await worktreeCommand(kitWith(), ["--cwd-file"], r.io), 2)
  assert.deepEqual(r.said, ["ade worktree: --cwd-file needs a path"])
  r = ioIn(main)
  assert.equal(await worktreeCommand(kitWith(), [], r.io), 0)
  assert.match(r.output(), /^usage: ade worktree /)
})
