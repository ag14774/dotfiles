import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DEFAULTS } from "../src/config.ts"
import { makeKit, run } from "../src/kit.ts"
import type { Config, Kit, Pane } from "../src/types.ts"
import { worktreeCommand } from "../src/worktree-cli.ts"
import type { Io } from "../src/worktrees.ts"
import { clone, convert, Failed, globIn, layoutFor, list, open, parseLanding, prune, records, remove, repositoryOf, seedsFor, worktreeFor } from "../src/worktrees.ts"

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
  assert.deepEqual(await repositoryOf(kitWith(), ioIn(join(project, "main")).io), { common: join(project, ".bare"), root: project, bare: true })
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
  const repo = { common, root: temp, bare: false }
  assert.deepEqual(seedsFor(repo, {}, DEFAULTS.worktrees.seed), { patterns: [".env", ".env.*", ".envrc", "pyrightconfig.json"], label: "default seed list" })
  assert.deepEqual(seedsFor(repo, { WT_SEED: "a\n\nb" }, DEFAULTS.worktrees.seed), { patterns: ["a", "b"], label: "WT_SEED" })
  assert.deepEqual(seedsFor(repo, { WT_SEED: "" }, DEFAULTS.worktrees.seed), { patterns: [], label: "WT_SEED" })
  writeFileSync(join(common, "wt-seed"), "# local\n\n  .env  \r\nconfig/*.toml\n")
  assert.deepEqual(seedsFor(repo, { WT_SEED: "a" }, DEFAULTS.worktrees.seed), { patterns: [".env", "config/*.toml"], label: join(common, "wt-seed") })
  for (const unsafe of ["/etc/passwd", "..", "../x", "a/../b", "a/.."]) {
    writeFileSync(join(common, "wt-seed"), `${unsafe}\n`)
    assert.throws(() => seedsFor(repo, {}, DEFAULTS.worktrees.seed), new Failed(`wt: unsafe seed pattern in ${join(common, "wt-seed")}: ${unsafe}`))
  }
  writeFileSync(join(common, "other"), "x\n")
  assert.deepEqual(seedsFor(repo, { WT_SEED_FILE: join(common, "other") }, DEFAULTS.worktrees.seed).patterns, ["x"])
  assert.throws(() => seedsFor(repo, { WT_SEED_FILE: join(common, "missing") }, DEFAULTS.worktrees.seed), new Failed(`wt: WT_SEED_FILE is not readable: ${join(common, "missing")}`))
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

test("worktreeFor: by branch, by folder name or by path; a name both ways is ambiguous", async () => {
  const repo = { common: join(project, ".bare"), root: project, bare: true }
  const io = ioIn(join(project, "main")).io
  assert.equal(await worktreeFor(kitWith(), io, repo, "topic/one"), join(project, "topic-one"))
  assert.equal(await worktreeFor(kitWith(), io, repo, "topic-one"), join(project, "topic-one"))
  assert.equal(await worktreeFor(kitWith(), io, repo, join(project, "feat")), join(project, "feat"))
  assert.equal(await worktreeFor(kitWith(), io, repo, join(project, "nope")), undefined)
  git(project, "worktree", "add", "-q", "-b", "clash", "elsewhere", "main")
  git(project, "worktree", "add", "-q", "-b", "other", "clash", "main")
  assert.equal(await worktreeFor(kitWith(), io, repo, "clash"), "ambiguous")
  assert.equal(await worktreeFor(kitWith(), io, repo, "nothing"), undefined)
})

test("remove and prune: the worktree goes, with the messages wt gives", async () => {
  const main = join(project, "main")
  let r = ioIn(main)
  await remove(kitWith(), r.io, [join(project, "clash")])
  assert.deepEqual(r.said, ["removed clash"])
  r = ioIn(main)
  await remove(kitWith(), r.io, ["clash"]) // now only a branch's name: its worktree is elsewhere
  assert.deepEqual(r.said, ["removed elsewhere"])
  await assert.rejects(remove(kitWith(), ioIn(main).io, ["clash"]), new Failed("wtrm: no worktree found for 'clash'"))
  await assert.rejects(remove(kitWith(), ioIn(main).io, []), new Failed("usage: wtrm [-f|--force] <branch|worktree>"))
  // A pushed branch whose remote branch was deleted.
  git(project, "worktree", "add", "-q", "-b", "done", "done", "main")
  git(join(project, "done"), "push", "-q", "-u", "origin", "done")
  git(origin, "branch", "-q", "-D", "done")
  r = ioIn(main)
  await assert.rejects(prune(kitWith(), r.io, []), new Failed("wtprune: no terminal to confirm; rerun with -y"))
  assert.deepEqual(r.said.filter((said) => said.startsWith("wtprune:") || said.startsWith(" ")), [
    "wtprune: git fetch --all --prune ...",
    "wtprune: worktrees to remove:",
    `  ${"done".padEnd(38)} (remote branch deleted)`,
  ])
  r = ioIn(main)
  await prune(kitWith(), { ...r.io, confirm: async () => true }, ["-n"])
  assert.equal(r.said.at(-1), "removed done")
  r = ioIn(main)
  await prune(kitWith(), r.io, ["-n", "-y"])
  assert.deepEqual(r.said, ["wtprune: nothing to remove."])
  await assert.rejects(prune(kitWith(), ioIn(main).io, ["-x"]), new Failed("usage: wtprune [-y] [-n|--no-fetch] [-m|--merged]"))
})

// A kit whose config has these worktree options.
const kitLaid = (worktrees: Partial<Config["worktrees"]>): Kit =>
  makeKit({ config: { ...structuredClone(DEFAULTS), multiplexer: "none", worktrees: { ...DEFAULTS.worktrees, ...worktrees } } as Config, run })
const layoutOf = (dir: string) => git(dir, "config", "--get", "ade.layout").trim()

test("layouts: where each puts a worktree, in a normal clone and in a bare repository", () => {
  const kit = kitWith()
  const plain = { common: "/code/repo/.git", root: "/code/repo", bare: false }
  const bare = { common: "/code/proj/.bare", root: "/code/proj", bare: true }
  assert.deepEqual(
    ["bare", "sibling", "inside"].map((name) => [kit.builtin.layout(name).path(plain, "feat-x"), kit.builtin.layout(name).path(bare, "feat-x")]),
    [
      ["/code/repo/feat-x", "/code/proj/feat-x"],
      ["/code/repo.feat-x", "/code/proj/feat-x"],
      ["/code/repo/.worktrees/feat-x", "/code/proj/feat-x"],
    ],
  )
})

test("a new repository takes the configured layout and keeps it when the config changes", async () => {
  const cloned = join(temp, "clones")
  mkdirSync(cloned)
  // sibling: a normal clone, worktrees beside it.
  let r = ioIn(cloned)
  await clone(kitLaid({ layout: "sibling" }), r.io, [origin, "side"])
  assert.equal(r.said.at(-1), "repo ready → cd side && wt <branch>")
  assert.equal(layoutOf(join(cloned, "side")), "sibling")
  r = ioIn(join(cloned, "side"))
  assert.deepEqual(await open(kitLaid({}), r.io, ["-s", "one"]), { dir: join(cloned, "side.one"), cd: false })
  // inside: worktrees in .worktrees, which git status doesn't show.
  await clone(kitLaid({ layout: "inside" }), ioIn(cloned).io, [origin, "in"])
  assert.deepEqual(await open(kitLaid({ layout: "bare" }), ioIn(join(cloned, "in")).io, ["-s", "two"]), {
    dir: join(cloned, "in", ".worktrees", "two"),
    cd: false,
  })
  assert.equal(git(join(cloned, "in"), "status", "--porcelain"), "")
  // A repository from before: its worktrees show its layout (nested: bare),
  // which is then recorded.
  git(cloned, "clone", "-q", origin, "old")
  git(join(cloned, "old"), "worktree", "add", "-q", "-b", "nested", "nested")
  assert.equal((await layoutFor(kitLaid({ layout: "sibling" }), ioIn(join(cloned, "old")).io, (await repositoryOf(kitWith(), ioIn(join(cloned, "old")).io))!)).choice, "bare")
  assert.deepEqual(await open(kitLaid({ layout: "sibling" }), ioIn(join(cloned, "old")).io, ["-s", "three"]), { dir: join(cloned, "old", "three"), cd: false })
  assert.equal(layoutOf(join(cloned, "old")), "bare")
  // A repository without worktrees: the configured layout; yours to set by hand.
  git(cloned, "clone", "-q", origin, "fresh")
  git(join(cloned, "fresh"), "config", "ade.layout", "inside")
  assert.deepEqual(await open(kitLaid({ layout: "sibling" }), ioIn(join(cloned, "fresh")).io, ["-s", "four"]), {
    dir: join(cloned, "fresh", ".worktrees", "four"),
    cd: false,
  })
  // A layout of your own, from the config.
  const mine = join(temp, "mine.ts")
  writeFileSync(mine, `export default (kit) => ({ ...kit.builtin.layout("sibling"), name: "mine", path: (repo, name) => repo.root + "-wt/" + name })`)
  git(cloned, "clone", "-q", origin, "custom")
  assert.deepEqual(await open(kitLaid({ layout: mine }), ioIn(join(cloned, "custom")).io, ["-s", "five"]), { dir: join(cloned, "custom-wt", "five"), cd: false })
  assert.equal(layoutOf(join(cloned, "custom")), mine)
})

test("wtconvert into bare: the clone's worktrees stay and work; a folder named like the branch; a hook's file kept", async () => {
  const dir = join(temp, "converts")
  mkdirSync(dir)
  // Worktrees inside the clone (as wt made them there) and beside it.
  const c1 = join(dir, "c1")
  git(dir, "clone", "-q", origin, "c1")
  git(c1, "worktree", "add", "-q", "-b", "nested", "nested")
  git(c1, "worktree", "add", "-q", "-b", "side", "../c1.side")
  writeFileSync(join(c1, "nested", "wip.txt"), "wip\n")
  let r = ioIn(c1)
  assert.deepEqual(await convert(kitLaid({}), r.io, ["-y"]), { dir: join(c1, "main"), cd: true })
  assert.ok(r.said.includes("  relinked 2 existing worktree(s)"), r.said.join("\n"))
  assert.equal(git(join(c1, "nested"), "status", "--porcelain"), "?? wip.txt\n")
  assert.equal(git(join(dir, "c1.side"), "symbolic-ref", "--short", "HEAD"), "side\n")
  assert.deepEqual(readdirSync(c1).sort(), [".bare", ".git", "main", "nested"])
  assert.equal(layoutOf(c1), "bare")
  // The branch is called like one of the clone's folders.
  const c2 = join(dir, "c2")
  git(dir, "clone", "-q", origin, "c2")
  git(c2, "switch", "-q", "-c", "docs")
  mkdirSync(join(c2, "docs"))
  writeFileSync(join(c2, "docs", "readme"), "docs\n")
  git(c2, "add", "docs")
  git(c2, "commit", "-q", "-m", "docs")
  assert.deepEqual(await convert(kitLaid({}), ioIn(c2).io, ["-y"]), { dir: join(c2, "docs"), cd: true })
  assert.equal(git(join(c2, "docs"), "symbolic-ref", "--short", "HEAD"), "docs\n")
  assert.deepEqual(readdirSync(join(c2, "docs")).sort(), [".git", "docs"])
  // A checkout hook makes .venv in the new worktree: the clone's own is kept beside it.
  const c3 = join(dir, "c3")
  git(dir, "clone", "-q", origin, "c3")
  writeFileSync(join(c3, ".gitignore"), ".venv/\n")
  git(c3, "add", ".gitignore")
  git(c3, "commit", "-q", "-m", "ignore")
  mkdirSync(join(c3, ".venv"))
  writeFileSync(join(c3, ".venv", "old"), "mine\n")
  writeFileSync(join(c3, ".git", "hooks", "post-checkout"), "#!/bin/sh\nmkdir -p .venv && : > .venv/made\n", { mode: 0o755 })
  r = ioIn(c3)
  await convert(kitLaid({}), r.io, ["-y"])
  assert.ok(r.said.includes("  kept (already in the worktree): .venv -> .venv.wtconvert-kept"), r.said.join("\n"))
  assert.deepEqual([readdirSync(join(c3, "main", ".venv")), readdirSync(join(c3, "main", ".venv.wtconvert-kept"))], [["made"], ["old"]])
})

test("wtconvert into sibling or inside: worktrees move where the layout puts them; refused when done already", async () => {
  const dir = join(temp, "relayouts")
  mkdirSync(dir)
  const s1 = join(dir, "s1")
  git(dir, "clone", "-q", origin, "s1")
  git(s1, "worktree", "add", "-q", "-b", "nested", "nested")
  writeFileSync(join(s1, "nested", "wip.txt"), "wip\n")
  await assert.rejects(convert(kitLaid({ layout: "sibling" }), ioIn(s1).io, []), new Failed("wtconvert: no terminal to confirm; rerun with -y"))
  // From inside the worktree that moves: you land in its new place.
  let r = ioIn(join(s1, "nested"))
  assert.deepEqual(await convert(kitLaid({ layout: "sibling" }), r.io, ["-y"]), { dir: join(dir, "s1.nested"), cd: true })
  assert.deepEqual(r.said.filter((said) => !said.startsWith("HEAD")), [
    "convert to the sibling layout:",
    `  repo:   ${s1}`,
    `  move:   ${join(s1, "nested")}  ->  ${join(dir, "s1.nested")}`,
    `done: ${s1} uses the sibling layout`,
  ])
  assert.equal(git(join(dir, "s1.nested"), "status", "--porcelain"), "?? wip.txt\n")
  assert.equal(git(s1, "status", "--porcelain"), "")
  assert.equal(layoutOf(s1), "sibling")
  await assert.rejects(convert(kitLaid({ layout: "sibling" }), ioIn(s1).io, ["-y"]), new Failed(`wtconvert: ${s1} uses the sibling layout already`))
  // inside: into .worktrees, which git status doesn't show.
  const i1 = join(dir, "i1")
  git(dir, "clone", "-q", origin, "i1")
  git(i1, "worktree", "add", "-q", "-b", "nested", "nested")
  assert.deepEqual(await convert(kitLaid({ layout: "inside" }), ioIn(i1).io, ["-y"]), { dir: i1, cd: true })
  assert.equal(git(join(i1, ".worktrees", "nested"), "symbolic-ref", "--short", "HEAD"), "nested\n")
  assert.equal(git(i1, "status", "--porcelain"), "")
  // A bare repository was converted already.
  await assert.rejects(convert(kitLaid({ layout: "sibling" }), ioIn(join(project, "main")).io, ["-y"]), new Failed(`wtconvert: ${project} is a bare repository (already converted?)`))
})
