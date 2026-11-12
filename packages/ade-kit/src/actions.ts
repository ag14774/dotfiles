// What the `ade` command (cli.ts) and the OpenCode plugins do. Each action
// works for a caller: its environment, which tells where it is in a
// multiplexer, and its folder. The rules: never switch you to another tab,
// act on the caller's session by name, refuse to guess when the caller's pane
// is gone.
import { existsSync } from "node:fs"
import { basename, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { onPath } from "./editor.ts"
import { labelOf, loadAgent, loadEditor, loadMultiplexer, loadReviewer } from "./load.ts"
import { isActive, paneWith, tabOf, tabsIn } from "./multiplexer.ts"
import { reviewerEnv, scopeOf } from "./review.ts"
import type { Agent, FileRef, Kit, Multiplexer, MultiplexerAdapter, Workspace } from "./types.ts"
import { callerFolder, located, realPath, sessionOf, workspaceOf, worktreesOf } from "./workspace.ts"

type Env = Record<string, string | undefined>
export type Caller = { env: Env; cwd: string }

// The `ade` command (for the reviewer's "open this file" key).
export const ADE = fileURLToPath(new URL("./cli.ts", import.meta.url))

// FILE[:LINE[:COLUMN]], relative to `cwd`. A file whose own name ends that
// way is taken as it is.
export function fileRef(arg: string, cwd: string): FileRef {
  const path = resolve(cwd, arg)
  const place = /^(.+?):(\d+)(?::(\d+))?$/.exec(arg)
  if (!place || existsSync(path)) return { path }
  return { path: resolve(cwd, place[1]), line: Number(place[2]), ...(place[3] ? { column: Number(place[3]) } : {}) }
}

// The caller's tab in its multiplexer, and the panes there are.
async function callerTab(kit: Kit, caller: Caller, why: string) {
  const adapter = await loadMultiplexer(kit)
  if (!adapter) throw new Error(`${why}, and no multiplexer is configured`)
  const where = adapter.here(caller.env)
  if (where?.pane === undefined) throw new Error(`not inside ${labelOf(adapter)}`)
  const mux = adapter.connect(where)
  const panes = await mux.panes()
  const tab = tabOf(panes, where.pane)
  if (tab === undefined) throw new Error(`pane ${where.pane} does not exist; not guessing which tab to use`)
  return { where, mux, panes, tab }
}

// The caller's multiplexer session, for the actions on its tabs (which don't
// need the caller's pane).
async function callerSession(kit: Kit, caller: Caller) {
  const adapter = await loadMultiplexer(kit)
  if (!adapter) throw new Error("there are no tabs without a multiplexer, and none is configured")
  const where = adapter.here(caller.env)
  if (!where) throw new Error(`not inside ${labelOf(adapter)}`)
  return { adapter, where, mux: adapter.connect(where) }
}

// An optional operation of the multiplexer, which an action needs.
function needs<K extends "openTab" | "showTab">(mux: Multiplexer, operation: K, adapter: MultiplexerAdapter) {
  const call = mux[operation]
  if (typeof call !== "function") throw new Error(`the multiplexer "${adapter.name}" lacks: ${operation}`)
  return call.bind(mux) as NonNullable<Multiplexer[K]>
}

export type TabIn = { tab: string; sure: boolean }

// The tabs working in each of `dirs` (see tabsIn), by folder as given. Each
// folder's repository tells which worktrees there are, so that a tab in a
// nested worktree doesn't count for the outer one.
export async function tabs(kit: Kit, dirs: string[], caller: Caller): Promise<Record<string, TabIn[]>> {
  const { mux } = await callerSession(kit, caller)
  const panes = await mux.panes()
  const repositories: string[][] = []
  const found: Record<string, TabIn[]> = {}
  for (const dir of dirs) {
    const path = realPath(resolve(caller.cwd, dir))
    let worktrees = repositories.find((list) => list.includes(path))
    if (!worktrees) repositories.push((worktrees = await worktreesOf(kit, path)))
    found[dir] = tabsIn(panes, path, worktrees)
  }
  return found
}

export type WorkspaceOptions = {
  dir: string
  focus: boolean // go to its tab; else it opens in the background
  session?: string // the conversation a new tab's agent shows
  prompt?: string // what a new tab's agent starts on
}

// How long a new tab's agent pane may take to be listed: looks, 50 ms apart.
const AGENT_PANE_LOOKS = 40
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

// The agent's command for a pane, its program found on the caller's PATH (the
// multiplexer may start it with another).
function agentCommand(agent: Agent, o: { session?: string; prompt?: string }, env: Env) {
  const [program, ...args] = agent.start(o)
  if (!program) throw new Error(`${labelOf(agent)} has no command`)
  if (program.includes("/")) return [program, ...args]
  const found = onPath([program], env.PATH ?? "")
  if (!found) throw new Error(`${labelOf(agent)} executable not found (tried ${program})`)
  return [found, ...args]
}

// Go to the tab working in the worktree `dir` (see tabsIn), or open the
// layout's tab there, in front or in the background. A tab with a pane that
// didn't say where it is counts: going to it is harmless, a duplicate is not.
// With a conversation or a prompt, the new tab's agent starts on them, and a
// worktree that has a tab is refused. `tell` gets what happened, to show.
export async function workspace(kit: Kit, o: WorkspaceOptions, caller: Caller, tell: (message: string) => void = () => {}) {
  const { adapter, mux } = await callerSession(kit, caller)
  const given = resolve(caller.cwd, o.dir)
  const dir = realPath(given)
  const name = basename(given)
  const starting = { ...(o.session ? { session: o.session } : {}), ...(o.prompt ? { prompt: o.prompt } : {}) }
  const agent = o.session || o.prompt ? await loadAgent(kit) : undefined
  const argv = agent && agentCommand(agent, starting, caller.env)
  const [found] = tabsIn(await mux.panes(), dir, await worktreesOf(kit, dir))
  if (found) {
    if (agent) throw new Error(`${name} already has a tab; send the prompt to its ${labelOf(agent)} instead`)
    if (o.focus) await needs(mux, "showTab", adapter)(found.tab)
    else tell(`${name} already has a tab`)
    return { tab: found.tab, opened: false }
  }
  const openTab = needs(mux, "openTab", adapter)
  let tab: string
  try {
    tab = await openTab({ dir, focus: o.focus })
  } catch {
    throw new Error(`could not open a ${labelOf(adapter)} tab for ${name}`)
  }
  if (!o.focus) tell(`opened tab ${name} in the background`)
  if (!agent || !argv) return { tab, opened: true }
  // The layout's agent pane, replaced by one on the conversation or prompt.
  let pane: string | undefined
  for (let look = 1; look <= AGENT_PANE_LOOKS && !pane; look++) {
    pane = paneWith(await mux.panes().catch(() => []), tab, "agent")?.id
    if (!pane) await sleep(50)
  }
  if (!pane) throw new Error(`no ${agent.name} pane in tab ${name}; prompt not sent (the tab stays open)`)
  try {
    await mux.start({ tab, role: "agent", argv, focus: false, replace: pane, cwd: dir })
  } catch {
    throw new Error(`could not start ${labelOf(agent)} with the prompt in tab ${name}`)
  }
  tell(`${labelOf(agent)} in tab ${name} is working on the prompt`)
  return { tab, opened: true }
}

// The workspace of `dir`; outside a repository, `dir` itself (programs reached
// through their panes don't need one).
const workspaceAt = async (kit: Kit, dir: string): Promise<Workspace> =>
  (await workspaceOf(kit, dir)) ?? { dir, session: sessionOf(dir) }

// Open files in the editor of the caller's tab, then focus it. In a tab you
// are not on, it only uses an editor that is already there, without focusing
// it. Lines are dropped for an editor that can't open a file at a line.
export async function open(kit: Kit, paths: string[], caller: Caller) {
  const editor = await loadEditor(kit)
  const label = labelOf(editor)
  const files = paths
    .map((arg) => fileRef(arg, caller.cwd))
    .map((file) => (editor.supports.line ? file : { path: file.path }))
  const { where, mux, panes, tab } = await callerTab(kit, caller, `${label} is reached through its pane`)
  const background = !isActive(await mux.tabs(), tab)
  const workspace = await workspaceAt(kit, callerFolder(panes, where, caller.cwd))
  const pane = paneWith(panes, tab, "editor")
  if (pane && !pane.running) {
    // A pane restored by session resurrection stays open after its program
    // quits (or waits for Enter to start it), so keys typed into it would
    // rerun the old one: start the editor afresh in its place.
    const argv = editor.start(files, workspace)
    try {
      await mux.start({ tab, role: "editor", argv, focus: !background, replace: pane.id })
    } catch (error) {
      throw new Error(`could not restart ${label} in the editor pane: ${(error as Error).message}`)
    }
  } else if (pane) {
    await editor.open(files, { workspace, mux, pane: pane.id })
    if (!background) await mux.focus(pane.id)
  } else if (background) {
    throw new Error(`tab ${tab} has no editor and is not the tab you are on; not switching tabs`)
  } else {
    await mux.start({ tab, role: "editor", argv: editor.start(files, workspace), focus: true })
  }
}

// What `ade send` passes on to the agent: a place in a file with the text
// selected there, or text as it is.
export type Sending =
  | { file: string; start?: string; end?: string; language?: string; selection: string }
  | { text: string; submit?: boolean }

// What is pasted for a place in a file, one paste each: "FILE:START-END "
// (FILE relative to the agent's folder when it is inside it), and when the
// selection is more than one character, the selection as a fenced block and
// a space. Separate pastes keep the reference readable when the agent shows
// a long paste as a placeholder ("[Pasted ~N lines]"). "[scratch]", Helix's
// name for a buffer without a file, has no reference.
export function pastes(o: Extract<Sending, { file: string }>, agentDir: string | undefined, cwd: string) {
  const pieces: string[] = []
  if (o.file !== "[scratch]") {
    const path = resolve(cwd, o.file)
    let reference = agentDir && path.startsWith(`${agentDir}/`) ? path.slice(agentDir.length + 1) : path
    if (o.start) reference += o.end && o.end !== o.start ? `:${o.start}-${o.end}` : `:${o.start}`
    pieces.push(`${reference} `)
  }
  if ([...o.selection].length > 1) {
    const fence = o.selection.includes("```") ? "````" : "```"
    pieces.push(`${fence}${o.language ?? ""}\n${o.selection}\n${fence}`, " ")
  }
  return pieces
}

// Give the agent of the caller's tab a place in a file (or text), for you to
// ask about, then focus it. Nothing is sent unless `submit` asks for it.
export async function send(kit: Kit, what: Sending, caller: Caller) {
  if ("text" in what && !what.text) throw new Error("no text to send")
  const agent = await loadAgent(kit)
  const label = labelOf(agent)
  const { where, mux, panes, tab } = await callerTab(kit, caller, `${label} is reached through its pane`)
  const pane = paneWith(panes, tab, "agent")
  if (!pane) throw new Error(`this tab has no ${label} pane`)
  const reach = { workspace: await workspaceAt(kit, callerFolder(panes, where, caller.cwd)), mux, pane: pane.id }
  if (!("text" in what)) for (const piece of pastes(what, pane.cwd, caller.cwd)) await agent.insert(piece, reach)
  else if (what.submit) await agent.submit(what.text, reach)
  else await agent.insert(what.text, reach)
  await mux.focus(pane.id)
}

// What `review` needs from the terminal it runs in.
export type Terminal = {
  // Run an interactive command here; its stdout is collected (error: it
  // could not start).
  interact(argv: string[], o: { cwd: string; env: Env }): Promise<{ stdout: string; error?: string }>
  // Show a message until you press a key.
  pause(message: string): Promise<void>
}

// Review the worktree of the pane you were in (see callerDir) with the
// reviewer, then hand its comments to the tab's agent (review.deliver: filled
// in for you to send, or sent). One review per tab: if the tab has one open
// (hidden after opening a file, say), show it instead of starting another.
export async function review(kit: Kit, caller: Caller, terminal: Terminal) {
  const at = await located(kit, caller.env)
  const panes = at && (await at.mux.panes())
  if (at && panes) {
    const tab = tabOf(panes, at.where.pane)
    const open = panes.find((p) => p.tab === tab && p.role === "review" && p.id !== at.where.pane && p.running)
    if (tab !== undefined && open) return at.mux.focus(open.id)
  }
  const dir = callerFolder(panes, at?.where, caller.cwd)
  const workspace = await workspaceOf(kit, dir)
  if (!workspace) return terminal.pause(`Nothing to review: ${dir} is not in a Git repository.`)
  const scope = await scopeOf(kit, workspace.dir)
  if (!scope.commits && !scope.uncommitted) {
    const remote = await kit.run(["git", "-C", workspace.dir, "rev-parse", "--verify", "--quiet", "origin/HEAD"])
    return terminal.pause(
      remote.ok
        ? `Nothing to review in ${workspace.dir}: no commits since origin/HEAD and no uncommitted changes.`
        : `Nothing to review in ${workspace.dir}: no uncommitted changes (and no origin/HEAD to compare commits with).`,
    )
  }
  const reviewer = await loadReviewer(kit)
  const env = reviewerEnv(reviewer, caller.env, ADE)
  const result = await terminal.interact(reviewer.command(scope), { cwd: workspace.dir, env })
  if (result.error) return terminal.pause(`Could not run ${labelOf(reviewer)}: ${result.error}`)
  const comments = result.stdout.replace(/\n+$/, "")
  if (!comments) return
  try {
    await send(kit, { text: comments, submit: kit.config.review.deliver === "submit" }, caller)
  } catch (error) {
    await terminal.pause(`${comments}\n\nThe comments above could not be sent: ${(error as Error).message}.`)
  }
}
