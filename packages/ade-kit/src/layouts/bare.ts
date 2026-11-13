// The bare layout (ours): a bare repository in <project>/.bare, a .git file
// pointing at it (so <project> acts as the repository's root), and a worktree
// per branch in <project>/<branch>. In a normal clone, worktrees go inside it
// (<repo>/<branch>), as wt always did; wtconvert turns it into this layout.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { Kit, Layout, WorktreeIo as Io } from "../types.ts"
import { isDirectory } from "../workspace.ts"
import { Failed, line, loud, query } from "../worktrees.ts"

export default (kit: Kit): Layout => {
  // Set up a .bare for worktrees (before fetching): origin's branches as
  // remote-tracking ones, which a bare clone doesn't make.
  const setUp = async (io: Io, root: string) => {
    const config = (...args: string[]) => query(kit, io, ["--git-dir", join(root, ".bare"), "config", ...args], root)
    await config("core.bare", "true")
    await config("core.logallrefupdates", "true")
    await config("--unset", "core.worktree")
    await config("remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*")
  }

  // After fetching: origin/HEAD, and the bare HEAD on the default branch.
  const finish = async (io: Io, root: string) => {
    const said = await query(kit, io, ["remote", "set-head", "origin", "--auto"], root)
    for (const text of (said ?? "").split("\n")) if (text) io.say(text)
    const head = line(await query(kit, io, ["--git-dir", join(root, ".bare"), "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], root))
    const branch = head?.replace(/^refs\/remotes\/origin\//, "")
    if (branch) await query(kit, io, ["--git-dir", join(root, ".bare"), "symbolic-ref", "HEAD", `refs/heads/${branch}`], root)
  }

  // wtclone: origin's branches as remote-tracking ones, no worktree yet.
  const clone = async (url: string, dir: string, io: Io) => {
    const root = resolve(io.cwd, dir)
    if (!(await loud(kit, io, ["init", "-q", "--bare", join(root, ".bare")]))) throw new Failed()
    writeFileSync(join(root, ".git"), "gitdir: ./.bare\n")
    await query(kit, io, ["--git-dir", join(root, ".bare"), "remote", "add", "origin", url])
    await setUp(io, root)
    if (!(await loud(kit, io, ["fetch", "origin"], root))) throw new Failed("wtclone: fetch failed")
    await finish(io, root)
    io.say(`worktree repo ready → cd ${dir} && wt <branch>`)
  }

  // wtconvert: turn the normal clone you are in into this layout. Refuses a
  // dirty tree; moves ignored files (.env, node_modules/) into the branch's new
  // worktree; removes only the top level's tracked files, which are committed.
  const convert = async (io: Io, { yes }: { yes: boolean }) => {
    if (line(await query(kit, io, ["rev-parse", "--is-inside-work-tree"])) !== "true")
      throw new Failed("wtconvert: run this inside a normal (non-bare) git clone")
    const root = line(await query(kit, io, ["rev-parse", "--show-toplevel"]))
    if (!root) throw new Failed()
    const branch = line(await query(kit, io, ["symbolic-ref", "--quiet", "--short", "HEAD"]))
    if (!branch) throw new Failed("wtconvert: detached HEAD -- check out a branch first")
    const name = branch.replaceAll("/", "-")
    if ((await query(kit, io, ["remote", "get-url", "origin"], root)) === undefined) throw new Failed("wtconvert: no 'origin' remote found")
    if (!isDirectory(join(root, ".git"))) throw new Failed(`wtconvert: ${root}/.git is not a repo dir (already converted?)`)
    if (await query(kit, io, ["status", "--porcelain", "--untracked-files=all"], root)) {
      io.say("wtconvert: working tree is dirty -- commit or stash changes first:")
      for (const text of ((await query(kit, io, ["status", "--short"], root)) ?? "").split("\n")) if (text) io.say(text)
      throw new Failed()
    }
    // Ignored paths to keep (whole ignored folders come as one).
    const status = (await query(kit, io, ["-c", "core.quotePath=false", "status", "--ignored", "--porcelain"], root)) ?? ""
    const ignored = status
      .split("\n")
      .filter((text) => text.startsWith("!! "))
      .map((text) => text.slice(3).replace(/\/$/, ""))
    io.say("convert to worktree layout:")
    io.say(`  repo:   ${root}`)
    io.say(`  branch: ${branch}  ->  ${root}/${name}`)
    if (ignored.length) io.say(`  keep:   ${ignored.length} ignored path(s) -> moved into the worktree`)
    if (!yes) {
      if (!io.confirm) throw new Failed("wtconvert: no terminal to confirm; rerun with -y")
      if (!(await io.confirm("proceed? [y/N] "))) {
        io.say("aborted")
        throw new Failed()
      }
    }
    // 1. .git becomes .bare, with a .git file pointing at it, set up as wtclone does.
    renameSync(join(root, ".git"), join(root, ".bare"))
    writeFileSync(join(root, ".git"), "gitdir: ./.bare\n")
    await setUp(io, root)
    if ((await query(kit, io, ["fetch", "origin"], root)) === undefined) io.say("wtconvert: warning: fetch failed (using existing refs)")
    await finish(io, root)
    // 2. The branch as a worktree (a fresh checkout of its tracked files).
    if (!(await loud(kit, io, ["worktree", "add", join(root, name), branch], root)))
      throw new Failed(`wtconvert: 'worktree add' failed; repo is bare at ${root} (your files are still there)`)
    // 3. The ignored files move into it.
    for (const rel of ignored) {
      const from = join(root, rel)
      const to = join(root, name, rel)
      if (!existsSync(from)) continue
      if (existsSync(to)) {
        io.say(`  skip (already in worktree): ${rel}`)
        continue
      }
      mkdirSync(dirname(to), { recursive: true })
      renameSync(from, to)
    }
    // 4. The top level's tracked files go (committed, so recoverable).
    for (const entry of readdirSync(root)) if (![".bare", ".git", name].includes(entry)) rmSync(join(root, entry), { recursive: true, force: true })
    io.say(`done -> ${join(root, name)}   (try: wtls, or wt <other-branch>)`)
    return join(root, name)
  }

  return { api: 1, name: "bare", label: "bare", path: (repo, name) => join(repo.root, name), clone, convert }
}
