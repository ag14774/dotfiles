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
import { Failed, globIn, list, open, parseLanding, records, repositoryOf, seedsFor } from "../src/worktrees.ts"

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

test("globIn: names, classes, folders at any depth; no leading dots for wildcards", () => {
  const root = join(temp, "glob")
  for (const file of [".env", ".env.local", ".envrc", "a.txt", "b.txt", "sub/.env", "sub/c.txt", ".hidden/.env", "d/e/.env"]) {
    mkdirSync(join(root, file, ".."), { recursive: true })
    writeFileSync(join(root, file), "")
  }
  assert.deepEqual(globIn(root, ".env"), [".env"])
  assert.deepEqual(globIn(root, ".env.*"), [".env.local"])
  assert.deepEqual(globIn(root, "*.txt"), ["a.txt", "b.txt"])
  assert.deepEqual(globIn(root, "[a]*"), ["a.txt"])
  assert.deepEqual(globIn(root, "[!a]*"), ["b.txt", "d", "sub"])
  assert.deepEqual(globIn(root, "*"), ["a.txt", "b.txt", "d", "sub"])
  assert.deepEqual(globIn(root, "**/.env"), [".env", "d/e/.env", "sub/.env"])
  assert.deepEqual(globIn(root, "sub/*"), ["sub/c.txt"])
  assert.deepEqual(globIn(root, "missing"), [])
  assert.deepEqual(globIn(root, "./sub/c.txt"), ["sub/c.txt"])
})

test("seedsFor: WT_SEED_FILE, the repository's manifest, WT_SEED, the defaults", () => {
  const common = join(temp, "seeds")
  mkdirSync(common)
  const repo = { common, root: temp }
  assert.deepEqual(seedsFor(repo, {}), { patterns: [".env", ".env.*", ".envrc", "pyrightconfig.json"], label: "default seed list" })
  assert.deepEqual(seedsFor(repo, { WT_SEED: "a\n\nb" }), { patterns: ["a", "b"], label: "WT_SEED" })
  assert.deepEqual(seedsFor(repo, { WT_SEED: "" }), { patterns: [], label: "WT_SEED" })
  writeFileSync(join(common, "wt-seed"), "# local\n\n  .env  \r\nconfig/*.toml\n")
  assert.deepEqual(seedsFor(repo, { WT_SEED: "a" }), { patterns: [".env", "config/*.toml"], label: join(common, "wt-seed") })
  for (const unsafe of ["/etc/passwd", "..", "../x", "a/../b", "a/.."]) {
    writeFileSync(join(common, "wt-seed"), `${unsafe}\n`)
    assert.throws(() => seedsFor(repo, {}), new Failed(`wt: unsafe seed pattern in ${join(common, "wt-seed")}: ${unsafe}`))
  }
  writeFileSync(join(common, "other"), "x\n")
  assert.deepEqual(seedsFor(repo, { WT_SEED_FILE: join(common, "other") }).patterns, ["x"])
  assert.throws(() => seedsFor(repo, { WT_SEED_FILE: join(common, "missing") }), new Failed(`wt: WT_SEED_FILE is not readable: ${join(common, "missing")}`))
})

test("parseLanding: the options before the branch", () => {
  assert.deepEqual(parseLanding("wt", ["x"]), { landing: { mode: "cd" }, rest: ["x"] })
  assert.deepEqual(parseLanding("wt", ["-t", "-t", "x", "-s"]), { landing: { mode: "tab" }, rest: ["x", "-s"] })
  assert.deepEqual(parseLanding("wt", ["-p", "go", "x"]), { landing: { mode: "background", prompt: "go" }, rest: ["x"] })
  assert.deepEqual(parseLanding("wt", ["--prompt=go", "-t", "--session", "s1", "--", "-x"]), {
    landing: { mode: "tab", prompt: "go", session: "s1" },
    rest: ["-x"],
  })
  for (const [args, said] of [
    [["-s", "-t", "x"], "wt: choose one of -s, -t or -b"],
    [["-p"], "wt: -p needs a prompt"],
    [["--session", ""], "wt: --session needs a conversation ID"],
    [["-x"], "wt: unknown option '-x'"],
    [["-s", "-p", "go", "x"], "wt: -p/--session need a tab; they cannot be combined with -s"],
  ] as const)
    assert.throws(() => parseLanding("wt", [...args]), new Failed(said))
})

test("open: a new branch from origin/HEAD, seeded, reused; git's output as messages in-process", async () => {
  const main = join(project, "main")
  writeFileSync(join(main, ".env"), "secret\n")
  let r = ioIn(main)
  assert.deepEqual(await open(kitWith(), r.io, ["-s", "topic/one"]), { dir: join(project, "topic-one"), cd: false })
  assert.ok(r.said.some((said) => said.startsWith("Preparing worktree")), r.said.join("\n"))
  assert.equal(r.said.at(-1), "wt: seeded 1 local file(s) from main/ (default seed list)")
  assert.equal(git(join(project, "topic-one"), "symbolic-ref", "--short", "HEAD"), "topic/one\n")
  r = ioIn(join(project, "feat"))
  assert.deepEqual(await open(kitWith(), r.io, ["topic/one"]), { dir: join(project, "topic-one"), cd: true })
  assert.deepEqual(r.said, [])
  await assert.rejects(open(kitWith(), ioIn(main).io, []), new Failed("usage: wt [-s|-t|-b] [-p PROMPT] [--session ID] <branch> [base]   (options before the branch)"))
  await assert.rejects(open(kitWith(), ioIn(temp).io, ["x"]), new Failed("wt: not inside a git repo"))
  // Without a multiplexer: -t changes directory, -p refuses before anything is made.
  r = ioIn(main)
  assert.deepEqual(await open(kitWith(), r.io, ["-t", "topic/one"]), { dir: join(project, "topic-one"), cd: true })
  assert.deepEqual(r.said, ["wt: no multiplexer is configured; changing directory instead of opening a tab"])
  await assert.rejects(open(kitWith(), ioIn(main).io, ["-p", "go", "never"]), new Failed("wt: -p/--session start OpenCode in a new tab; no multiplexer is configured"))
})
