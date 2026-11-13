// Worktrees: what the wt shell functions (shell/worktree.zsh) do, through
// `ade worktree` (worktree-cli.ts), and in-process for the OpenCode plugin.
// Messages are the wt commands' own ("wt: ..."). Nothing here changes the
// process's folder or reads its environment: both come with the Io.
import { spawn } from "node:child_process"
import { accessSync, constants, cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import type { TabIn } from "./actions.ts"
import { closeTabs, tabs, workspace } from "./actions.ts"
import { onPath } from "./editor.ts"
import { labelOf, loadAgent, loadMultiplexer } from "./load.ts"
import type { Kit, MultiplexerAdapter, Where } from "./types.ts"
import { isDirectory, realPath } from "./workspace.ts"

type Env = Record<string, string | undefined>

// Where a command runs, and how it talks to you.
export type Io = {
  env: Env
  cwd: string
  say(line: string): void // a message (the CLI: stderr)
  // Git's own output (progress, "Preparing worktree ..."): straight to stderr
  // as it runs (the CLI), or else line by line through say.
  passthrough: boolean
  // A yes/no question; absent when there is no terminal to ask in.
  confirm?(question: string): Promise<boolean>
}

// A command failed; its message (if any) is the line to show. Git's own error
// has been shown already when the message is empty.
export class Failed extends Error {}

// A git query: its output, or undefined when it fails. No timeout: a status
// in a big repository can be slow.
export async function query(kit: Kit, io: Io, args: string[], cwd = io.cwd) {
  const result = await kit.run(["git", ...args], { cwd, env: io.env, timeout: 0 })
  return result.ok ? result.stdout : undefined
}
const line = (text: string | undefined) => text?.replace(/\n$/, "")

// A git command whose own output you see. Never on stdout: callers capture
// `wt -s`'s path, and a background job git starts must not hold it open.
export async function loud(kit: Kit, io: Io, args: string[], cwd = io.cwd): Promise<boolean> {
  if (io.passthrough)
    return new Promise((done) => {
      const child = spawn("git", args, { cwd, env: io.env as NodeJS.ProcessEnv, stdio: ["inherit", 2, 2] })
      child.on("error", () => done(false))
      child.on("close", (code) => done(code === 0))
    })
  const result = await kit.run(["git", ...args], { cwd, env: io.env, timeout: 0 })
  for (const text of `${result.stdout}${result.stderr}`.split("\n")) if (text) io.say(text)
  return result.ok
}

// The repository the caller is in: its Git common folder (.bare, .git), and
// the folder its worktrees go in (the common folder's parent: the project in
// the bare layout, the clone itself otherwise).
export type Repository = { common: string; root: string }
export async function repositoryOf(kit: Kit, io: Io, cwd = io.cwd): Promise<Repository | undefined> {
  const common = line(await query(kit, io, ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd))
  return common ? { common, root: common.replace(/\/[^/]+$/, "") || "/" } : undefined
}

// `git worktree list --porcelain`, record by record.
export type WorktreeRecord = { path: string; branch?: string; bare: boolean }
export function records(porcelain: string): WorktreeRecord[] {
  const found: WorktreeRecord[] = []
  for (const record of porcelain.split("\n")) {
    if (record.startsWith("worktree ")) found.push({ path: record.slice(9), bare: false })
    else if (record.startsWith("branch refs/heads/") && found.length) found[found.length - 1].branch = record.slice(18)
    else if (record === "bare" && found.length) found[found.length - 1].bare = true
  }
  return found
}
export const worktreeRecords = async (kit: Kit, io: Io, cwd: string, ...gitDir: string[]) =>
  records((await query(kit, io, [...gitDir, "worktree", "list", "--porcelain"], cwd)) ?? "")

// The caller's multiplexer session when it runs inside the configured one;
// otherwise why not ("not inside Zellij", or none configured).
export async function multiplexerOf(kit: Kit, env: Env): Promise<{ adapter?: MultiplexerAdapter; where?: Where; why: string }> {
  const adapter = await loadMultiplexer(kit)
  if (!adapter) return { why: "no multiplexer is configured" }
  const label = adapter.label ?? adapter.name
  const where = adapter.here(env)
  return where ? { adapter, where, why: "" } : { adapter, why: `not inside ${label}` }
}

// The worktree checked out on `branch`, wherever it is.
export const worktreeOf = async (kit: Kit, io: Io, repo: Repository, branch: string) =>
  (await worktreeRecords(kit, io, repo.root)).find((r) => r.branch === branch)?.path

// The worktree of the default branch (origin/HEAD's, else HEAD's): where new
// worktrees are seeded from when you are not in one.
export async function defaultWorktree(kit: Kit, io: Io, repo: Repository) {
  const ref = async (name: string) => line(await query(kit, io, ["--git-dir", repo.common, "symbolic-ref", "--quiet", name]))
  const branch =
    (await ref("refs/remotes/origin/HEAD"))?.replace(/^refs\/remotes\/origin\//, "") ||
    (await ref("HEAD"))?.replace(/^refs\/heads\//, "")
  if (!branch) return undefined
  return (await worktreeRecords(kit, io, io.cwd, "--git-dir", repo.common)).find((r) => r.branch === branch)?.path
}

// --- Seeding: untracked files (secrets, local config) that git won't carry
// into a new worktree. WT_SEED_FILE names a manifest; else the repository's
// <common-dir>/wt-seed; else WT_SEED (newline-separated); else the defaults.
// A manifest has one relative path or glob per line (blank lines and comments
// allowed). Not .venv or node_modules: recreate those.
export const SEED_DEFAULTS = [".env", ".env.*", ".envrc", "pyrightconfig.json"]
export type Seeds = { patterns: string[]; label: string }

const readable = (path: string) => {
  try {
    accessSync(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

// The seed patterns; refuses an unreadable WT_SEED_FILE, or a manifest line
// that leaves the worktree.
export function seedsFor(repo: Repository, env: Env): Seeds {
  const file = env.WT_SEED_FILE || join(repo.common, "wt-seed")
  if (env.WT_SEED_FILE && !readable(file)) throw new Failed(`wt: WT_SEED_FILE is not readable: ${file}`)
  if (readable(file)) {
    let text = ""
    try {
      text = readFileSync(file, "utf8")
    } catch {
      // a folder, say: no patterns
    }
    const patterns = []
    for (const raw of text.split("\n")) {
      const pattern = raw.replace(/\r$/, "").trim()
      if (!pattern || pattern.startsWith("#")) continue
      if (/^\/|^\.\.(\/|$)|\/\.\.(\/|$)/.test(pattern)) throw new Failed(`wt: unsafe seed pattern in ${file}: ${pattern}`)
      patterns.push(pattern)
    }
    return { patterns, label: file }
  }
  if (env.WT_SEED !== undefined) return { patterns: env.WT_SEED.split("\n").filter(Boolean), label: "WT_SEED" }
  return { patterns: SEED_DEFAULTS, label: "default seed list" }
}

// A name pattern (*, ?, [...]) as a regular expression.
function nameRegex(pattern: string) {
  let source = ""
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    const close = c === "[" ? pattern.indexOf("]", i + 2) : -1
    if (c === "*") source += ".*"
    else if (c === "?") source += "."
    else if (close > 0) {
      const inside = pattern.slice(i + 1, close)
      source += `[${/^[!^]/.test(inside) ? `^${inside.slice(1)}` : inside}]`.replace(/\\/g, "\\\\")
      i = close
    } else source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${source}$`, "s")
}

// The paths under `root` that a seed pattern matches, relative to it, sorted:
// *, ? and [...] within a name, ** for any depth of folders. As in zsh, a
// wildcard doesn't match a name's leading dot, and a pattern without
// wildcards is there when the file is.
export function globIn(root: string, pattern: string): string[] {
  const parts = pattern.split("/").filter((part) => part && part !== ".")
  const found: string[] = []
  const entries = (dir: string) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
  }
  const walk = (dir: string, rel: string, rest: string[]) => {
    const [part, ...after] = rest
    if (part === undefined) return void (rel && found.push(rel))
    const into = (name: string) => [join(dir, name), rel ? `${rel}/${name}` : name] as const
    if (part === "**" && after.length) {
      walk(dir, rel, after)
      for (const entry of entries(dir)) if (entry.isDirectory() && !entry.name.startsWith(".")) walk(...into(entry.name), rest)
      return
    }
    if (!/[*?[]/.test(part)) {
      const [path, next] = into(part)
      if (after.length ? isDirectory(path) : existsSync(path)) walk(path, next, after)
      return
    }
    const regex = nameRegex(part === "**" ? "*" : part)
    for (const entry of entries(dir)) {
      if (entry.name.startsWith(".") && !part.startsWith(".")) continue
      if (!regex.test(entry.name)) continue
      const [path, next] = into(entry.name)
      if (!after.length || isDirectory(path)) walk(path, next, after)
    }
  }
  walk(root, "", parts)
  return [...new Set(found)].sort()
}

// Copy the seeds from worktree `from` into the new worktree `to`, except what
// is there already (each worktree keeps its own copies).
export function seed(io: Io, from: string | undefined, to: string, seeds: Seeds) {
  if (!from || !isDirectory(from) || from === to) return
  let copied = 0
  for (const pattern of seeds.patterns)
    for (const rel of globIn(from, pattern)) {
      const target = join(to, rel)
      if (existsSync(target)) continue
      try {
        mkdirSync(dirname(target), { recursive: true })
        cpSync(join(from, rel), target, { recursive: true, verbatimSymlinks: true })
        copied++
      } catch (error) {
        io.say(`wt: could not seed ${rel}: ${(error as Error).message}`)
      }
    }
  if (copied) io.say(`wt: seeded ${copied} local file(s) from ${basename(from)}/ (${seeds.label})`)
}

// --- Landing: what happens once the worktree exists. -s reports it; -t
// focuses its tab (opening one), -b opens it in the background; -p/--session
// start the agent in a new background tab. Without either, the caller changes
// to it (the shell function cds). Outside a multiplexer, -t changes directory,
// -b stays and -p fails.
export type Landing = { mode: "cd" | "stay" | "tab" | "background"; prompt?: string; session?: string }
export type Landed = { dir: string; cd: boolean }

// The landing options before the other arguments (`name` for messages).
export function parseLanding(name: string, args: string[]): { landing: Landing; rest: string[] } {
  const modes: Landing["mode"][] = []
  let prompt = ""
  let session = ""
  let i = 0
  for (; i < args.length; i++) {
    const arg = args[i]
    if (arg === "-s" || arg === "--stay") modes.push("stay")
    else if (arg === "-t" || arg === "--tab") modes.push("tab")
    else if (arg === "-b" || arg === "--background") modes.push("background")
    else if (arg === "-p" || arg === "--prompt") {
      if (i + 1 >= args.length) throw new Failed(`${name}: ${arg} needs a prompt`)
      prompt = args[++i]
    } else if (arg.startsWith("--prompt=")) prompt = arg.slice(9)
    else if (arg === "--session") {
      if (!args[i + 1]) throw new Failed(`${name}: ${arg} needs a conversation ID`)
      session = args[++i]
    } else if (arg === "--") {
      i++
      break
    } else if (arg.startsWith("-")) throw new Failed(`${name}: unknown option '${arg}'`)
    else break
  }
  const unique = [...new Set(modes)]
  if (unique.length > 1) throw new Failed(`${name}: choose one of -s, -t or -b`)
  let mode = unique[0]
  if (prompt || session) {
    if (mode === "stay") throw new Failed(`${name}: -p/--session need a tab; they cannot be combined with -s`)
    mode ??= "background"
  }
  const landing = { mode: mode ?? "cd", ...(prompt ? { prompt } : {}), ...(session ? { session } : {}) }
  return { landing, rest: args.slice(i) }
}

const message = (error: unknown) => String((error as Error)?.message ?? error).replace(/^ade: /, "")

// A tab needs a multiplexer: -p/--session fail before anything is created.
async function needsTab(kit: Kit, io: Io, name: string, landing: Landing) {
  if (!landing.prompt && !landing.session) return
  const at = await multiplexerOf(kit, io.env).catch((error) => {
    throw new Failed(`${name}: ${message(error)}`)
  })
  if (at.where) return
  const agent = await loadAgent(kit).then(labelOf, () => "the agent")
  const where = at.adapter ? `a ${labelOf(at.adapter)} tab` : "a new tab"
  throw new Failed(`${name}: -p/--session start ${agent} in ${where}; ${at.why}`)
}

export async function land(kit: Kit, io: Io, dir: string, name: string, landing: Landing): Promise<Landed> {
  let mode = landing.mode
  if (mode === "tab" || mode === "background") {
    const at = await multiplexerOf(kit, io.env).catch((error) => {
      throw new Failed(`${name}: ${message(error)}`)
    })
    if (!at.where) {
      io.say(`${name}: ${at.why}; ${mode === "tab" ? "changing directory" : "staying here"} instead of opening a tab`)
      mode = mode === "tab" ? "cd" : "stay"
    }
  }
  if (mode === "cd" || mode === "stay") return { dir, cd: mode === "cd" }
  const o = { dir, focus: mode === "tab", ...(landing.session ? { session: landing.session } : {}), ...(landing.prompt ? { prompt: landing.prompt } : {}) }
  try {
    await workspace(kit, o, { env: io.env, cwd: io.cwd }, (said) => io.say(`${name}: ${said}`))
  } catch (error) {
    throw new Failed(`${name}: ${message(error)}`)
  }
  return { dir, cd: false }
}

// wt: the worktree for a branch, created if needed (a local branch as it is;
// one only on origin, tracking it; else a new branch from `base`, default
// origin/HEAD, without an upstream), seeded, then landed on.
export const WT_USAGE = "usage: wt [-s|-t|-b] [-p PROMPT] [--session ID] <branch> [base]   (options before the branch)"
export async function open(kit: Kit, io: Io, args: string[]): Promise<Landed> {
  const { landing, rest } = parseLanding("wt", args)
  await needsTab(kit, io, "wt", landing)
  const [branch, given] = rest
  if (!branch || rest.length > 2 || branch.startsWith("-") || given?.startsWith("-")) throw new Failed(WT_USAGE)
  const repo = await repositoryOf(kit, io)
  if (!repo) throw new Failed("wt: not inside a git repo")
  const existing = await worktreeOf(kit, io, repo, branch)
  if (existing) return land(kit, io, existing, "wt", landing)
  const dir = join(repo.root, branch.replaceAll("/", "-"))
  if (!isDirectory(dir)) {
    const seeds = seedsFor(repo, io.env)
    await loud(kit, io, ["fetch", "-q", "origin"], repo.root)
    const has = async (ref: string) => (await query(kit, io, ["show-ref", "-q", "--verify", ref], repo.root)) !== undefined
    const add = (await has(`refs/heads/${branch}`))
      ? ["worktree", "add", dir, branch]
      : (await has(`refs/remotes/origin/${branch}`))
        ? ["worktree", "add", "--track", "-b", branch, dir, `origin/${branch}`]
        : ["worktree", "add", "--no-track", "-b", branch, dir, given || "origin/HEAD"]
    if (!(await loud(kit, io, add, repo.root))) throw new Failed()
    // From the worktree you are in; from the project folder, the default branch's.
    let from = line(await query(kit, io, ["rev-parse", "--show-toplevel"])) || (await defaultWorktree(kit, io, repo))
    if (from === dir) from = undefined
    seed(io, from, dir, seeds)
  }
  return land(kit, io, dir, "wt", landing)
}

// The worktree `arg` names: a branch's, a folder's (by its name), or an
// absolute path. "ambiguous" when it is a branch of one worktree and the
// folder of another.
export async function worktreeFor(kit: Kit, io: Io, repo: Repository, arg: string): Promise<string | "ambiguous" | undefined> {
  const found = await worktreeRecords(kit, io, repo.root)
  if (arg.startsWith("/")) return found.some((r) => r.path === arg) ? arg : undefined
  const byBranch = found.find((r) => r.branch === arg)?.path
  const byName = found.filter((r) => r.path !== repo.root && basename(r.path) === arg).at(-1)?.path
  if (byBranch && byName && byBranch !== byName) return "ambiguous"
  if (byBranch ?? byName) return byBranch ?? byName
  const guess = join(repo.root, arg.replaceAll("/", "-"))
  return isDirectory(guess) ? guess : undefined
}

// The tabs working in worktree `dir` (none outside a multiplexer).
async function tabsOf(kit: Kit, io: Io, dir: string) {
  if (!(await multiplexerOf(kit, io.env).catch(() => undefined))?.where) return []
  const path = realPath(dir)
  return (await tabs(kit, [path], { env: io.env, cwd: io.cwd }).catch(() => ({}) as Record<string, TabIn[]>))[path] ?? []
}

// wtrm: remove a worktree (-f: even with changes), then close the tabs working
// in it, except yours (see actions.closeTabs).
export async function remove(kit: Kit, io: Io, args: string[]) {
  const force = args[0] === "-f" || args[0] === "--force"
  const arg = args[force ? 1 : 0]
  if (!arg) throw new Failed("usage: wtrm [-f|--force] <branch|worktree>")
  const repo = await repositoryOf(kit, io)
  if (!repo) throw new Failed("wtrm: not inside a git repo")
  const target = await worktreeFor(kit, io, repo, arg)
  if (target === "ambiguous") throw new Failed(`wtrm: '${arg}' matches both a branch and a worktree directory; use the absolute path`)
  if (!target) throw new Failed(`wtrm: no worktree found for '${arg}'`)
  // Their shells would be left in a deleted folder. Found now: once it is
  // removed, their panes' folders are gone.
  const found = await tabsOf(kit, io, target)
  if (!(await loud(kit, io, ["worktree", "remove", ...(force ? ["--force"] : []), target], repo.root))) throw new Failed()
  io.say(`removed ${basename(target)}`)
  if (found.length)
    await closeTabs(kit, target, found, { env: io.env, cwd: io.cwd }, io.say).catch((error) => io.say(`wtrm: ${message(error)}`))
}

// Whether `branch` was merged through a GitHub PR: one whose head is exactly
// its tip. Not ancestry: a new branch without commits is an ancestor of the
// default branch too, and a reused name must not match an old PR.
async function mergedPr(kit: Kit, io: Io, repo: Repository, branch: string) {
  const tip = line(await query(kit, io, ["rev-parse", `refs/heads/${branch}`], repo.root))
  if (!tip) return undefined
  const jq = `.[] | select(.headRefOid=="${tip}") | .number`
  const args = ["pr", "list", "--head", branch, "--state", "merged", "--json", "number,headRefOid", "--jq", jq]
  const result = await kit.run(["gh", ...args], { cwd: repo.root, env: io.env, timeout: 0 })
  const pr = result.ok ? result.stdout.split("\n")[0] : ""
  return pr ? `merged PR #${pr}` : undefined
}

// wtprune: remove the worktrees whose branch's remote branch was deleted (its
// upstream is "gone"; branches that never had one are new work and stay), and
// with -m those merged through a PR (GitHub only); never the default branch's
// or the one you are in. Fetches with --prune first (-n: not), lists them,
// then asks (-y: doesn't).
export const PRUNE_USAGE = "usage: wtprune [-y] [-n|--no-fetch] [-m|--merged]"
export async function prune(kit: Kit, io: Io, args: string[]) {
  let yes = false
  let fetch = true
  let merged = false
  for (const arg of args) {
    if (arg === "-y" || arg === "--yes") yes = true
    else if (arg === "-n" || arg === "--no-fetch") fetch = false
    else if (arg === "-m" || arg === "--merged") merged = true
    else throw new Failed(PRUNE_USAGE)
  }
  const repo = await repositoryOf(kit, io)
  if (!repo) throw new Failed("wtprune: not inside a git repo")
  if (fetch) {
    io.say("wtprune: git fetch --all --prune ...")
    if (!(await loud(kit, io, ["fetch", "--all", "--prune", "--quiet"], repo.root)))
      io.say("wtprune: fetch failed; continuing with cached remote-tracking refs")
  }
  const head = line(await query(kit, io, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], repo.root))
  const defaultBranch = head?.replace(/^refs\/remotes\/origin\//, "")
  const refs = (await query(kit, io, ["for-each-ref", "--format=%(refname:short)%09%(upstream)%09%(upstream:track)", "refs/heads"], repo.root)) ?? ""
  const gone = new Set(
    refs
      .split("\n")
      .map((row) => row.split("\t"))
      .filter(([, upstream, track]) => upstream && track?.includes("gone"))
      .map(([branch]) => branch),
  )
  const gh = merged && onPath(["gh"], io.env.PATH ?? "")
  if (merged && !gh) io.say("wtprune: --merged needs gh (GitHub CLI); without it, only deleted-remote branches are removed")
  const here = line(await query(kit, io, ["rev-parse", "--show-toplevel"]))
  const targets: { path: string; why: string }[] = []
  for (const { path, branch } of await worktreeRecords(kit, io, repo.root)) {
    if (!branch || branch === defaultBranch) continue
    if (here && path === here) {
      if (gone.has(branch)) io.say(`wtprune: skipping current worktree '${branch}' -- cd elsewhere and rerun`)
      continue
    }
    const why = gone.has(branch) ? "remote branch deleted" : gh ? await mergedPr(kit, io, repo, branch) : undefined
    if (why) targets.push({ path, why })
  }
  if (!targets.length) return io.say("wtprune: nothing to remove.")
  io.say("wtprune: worktrees to remove:")
  for (const { path, why } of targets) io.say(`  ${basename(path).padEnd(38)} (${why})`)
  if (!yes) {
    if (!io.confirm) throw new Failed("wtprune: no terminal to confirm; rerun with -y")
    if (!(await io.confirm("remove them? [y/N] "))) {
      io.say("aborted")
      throw new Failed()
    }
  }
  let failed = false
  for (const { path } of targets)
    await remove(kit, io, [path]).catch((error) => {
      if (!(error instanceof Failed)) throw error
      if (error.message) io.say(error.message)
      failed = true
    })
  if (failed) throw new Failed()
}

export type Listed = {
  path: string
  branch: string | null
  changed: number // files with uncommitted changes
  ahead: number | null // commits relative to origin/HEAD (null without it)
  behind: number | null
  tab: "sure" | "unsure" | null // see tabsIn; null outside a multiplexer
}

// The repository's worktrees (no bare repository, no folder deleted by hand),
// for `wtls --json` and the plugin's status.
export async function list(kit: Kit, io: Io): Promise<Listed[]> {
  if ((await query(kit, io, ["rev-parse", "--git-dir"])) === undefined) throw new Failed("wtls: not inside a git repo")
  const base = line(await query(kit, io, ["rev-parse", "--verify", "--quiet", "origin/HEAD"]))
  const found = (await worktreeRecords(kit, io, io.cwd)).filter((r) => !r.bare && isDirectory(r.path))
  const paths = found.map((r) => r.path)
  let tabsOf: Record<string, { sure: boolean }[]> = {}
  if (paths.length && (await multiplexerOf(kit, io.env).catch(() => undefined))?.where)
    tabsOf = await tabs(kit, paths, { env: io.env, cwd: io.cwd }).catch(() => ({}))
  return Promise.all(
    found.map(async ({ path, branch }) => {
      const counts = base ? line(await query(kit, io, ["rev-list", "--left-right", "--count", `${base}...HEAD`], path)) : undefined
      const [behind, ahead] = counts ? counts.split("\t").map(Number) : [null, null]
      const status = (await query(kit, io, ["status", "--porcelain"], path)) ?? ""
      const first = tabsOf[path]?.[0]
      return {
        path,
        branch: branch || null,
        changed: status.split("\n").length - 1,
        ahead,
        behind,
        tab: first ? (first.sure ? "sure" : "unsure") : null,
      } satisfies Listed
    }),
  )
}
