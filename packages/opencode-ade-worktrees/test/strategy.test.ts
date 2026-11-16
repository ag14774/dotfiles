import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { nameIn, strategy } from "../src/strategy.ts"

const temp = realpathSync(mkdtempSync(join(tmpdir(), "ade-strategy-")))
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })

// An origin, and a clone in the bare layout with main (and a .env to seed).
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
writeFileSync(join(project, "main", ".env"), "secret\n")

// A stand-in for the OpenCode CLI, so that no test reaches your service: its
// service runs at FAKE_OPENCODE_URL with the locations
// FAKE_OPENCODE_LOCATIONS, and each call is logged to FAKE_OPENCODE_LOG.
const bin = join(temp, "bin")
mkdirSync(bin)
writeFileSync(
  join(bin, "opencode"),
  `#!/bin/sh
echo "$*" >> "$FAKE_OPENCODE_LOG"
case "$1 $2" in
  "service status") echo "$FAKE_OPENCODE_URL" ;;
  "api get") echo "$FAKE_OPENCODE_LOCATIONS" ;;
  "api delete") ;;
  *) exit 1 ;;
esac
`,
  { mode: 0o755 },
)
const log = join(temp, "opencode.log")

const data = join(temp, "data")
// No ADE config of your own: the defaults (the bare layout). OpenCode's
// service has a location in each worktree removed below, and in main.
const env = {
  PATH: `${bin}:${process.env.PATH}`,
  HOME: temp,
  XDG_DATA_HOME: data,
  XDG_CONFIG_HOME: join(temp, "config"),
  FAKE_OPENCODE_URL: "http://127.0.0.1:4096",
  FAKE_OPENCODE_LOCATIONS: JSON.stringify(
    ["main", "feat-x", "seeded"].map((name) => ({ directory: join(project, name) })),
  ),
  FAKE_OPENCODE_LOG: log,
}
class ForceRequired extends Error {}
const s = strategy({ env, projectID: "abcdef0123", forceRequired: (message) => new ForceRequired(message) })
const suggested = (name: string) => join(data, "opencode", "worktree", "abcdef", name)

test("nameIn: the name below OpenCode's default parent, else the folder's name", () => {
  assert.equal(nameIn(suggested("feat/x"), env, "abcdef0123"), "feat/x")
  assert.equal(nameIn("/elsewhere/task", env, "abcdef0123"), "task")
})

test("create: ade worktree open's folder and a real branch, from the start ref, seeded; reused", async () => {
  assert.equal(s.id, "git")
  // OpenCode starts from the canonical checkout: in the bare layout, .bare.
  const made = await s.create({
    directory: suggested("feat/x"),
    sourceDirectory: join(project, ".bare"),
    branch: "main",
  })
  assert.deepEqual(made, { directory: join(project, "feat-x") })
  assert.equal(git(made.directory, "symbolic-ref", "--short", "HEAD"), "feat/x\n")
  assert.throws(() => git(made.directory, "config", "--get", "branch.feat/x.remote")) // no upstream yet
  writeFileSync(join(project, "feat-x", "draft.md"), "unsaved\n")
})

test("create: an existing branch's worktree is returned as it is; failures say why", async () => {
  assert.deepEqual(await s.create({ directory: suggested("feat/x"), sourceDirectory: join(project, ".bare") }), {
    directory: join(project, "feat-x"),
  })
  await assert.rejects(
    s.create({ directory: suggested("-x"), sourceDirectory: join(project, ".bare") }),
    /usage: ade worktree open /,
  )
})

test("create seeds from the default branch's worktree", async () => {
  const made = await s.create({ directory: suggested("seeded"), sourceDirectory: join(project, ".bare") })
  assert.equal(git(made.directory, "status", "--porcelain"), "?? .env\n") // not ignored in this repository
})

test("list: the repository's worktrees, its first entry as the root", async () => {
  assert.deepEqual(await s.list(join(project, "main")), [
    { directory: join(project, ".bare"), type: "root" },
    { directory: join(project, "feat-x"), type: "worktree" },
    { directory: join(project, "main"), type: "worktree" },
    { directory: join(project, "seeded"), type: "worktree" },
  ])
})

test("remove: a worktree with changes needs force (OpenCode asks); then it goes, and the service lets go of it", async () => {
  for (const name of ["feat-x", "seeded"]) {
    await assert.rejects(s.remove({ directory: join(project, name), force: false }), ForceRequired)
    await s.remove({ directory: join(project, name), force: true })
  }
  assert.deepEqual(
    (await s.list(join(project, "main"))).map((w) => w.directory),
    [join(project, ".bare"), join(project, "main")],
  )
  // OpenCode keeps a removed worktree's location, and its reload fails on it.
  const evicted = readFileSync(log, "utf8")
    .split("\n")
    .filter((call) => call.startsWith("api delete"))
  assert.deepEqual(
    [...new Set(evicted)],
    ["feat-x", "seeded"].map(
      (name) => `api delete /api/debug/location?location%5Bdirectory%5D=${encodeURIComponent(join(project, name))}`,
    ),
  )
  await assert.rejects(
    s.remove({ directory: join(project, "gone"), force: false }),
    /ade worktree rm: no worktree found/,
  )
})
