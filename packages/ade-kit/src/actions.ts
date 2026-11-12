// What the `ade` command (cli.ts) and the OpenCode plugins do. Each action
// works for a caller: its environment, which tells where it is in a
// multiplexer, and its folder. The rules: never switch you to another tab,
// act on the caller's session by name, refuse to guess when the caller's pane
// is gone.
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { labelOf, loadEditor, loadMultiplexer } from "./load.ts"
import { isActive, paneWith, tabOf } from "./multiplexer.ts"
import type { FileRef, Kit, Workspace } from "./types.ts"
import { callerFolder, sessionOf, workspaceOf } from "./workspace.ts"

export type Caller = { env: Record<string, string | undefined>; cwd: string }

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
  if (!where) throw new Error(`not inside ${labelOf(adapter)}`)
  const mux = adapter.connect(where)
  const panes = await mux.panes()
  const tab = tabOf(panes, where.pane)
  if (tab === undefined) throw new Error(`pane ${where.pane} does not exist; not guessing which tab to use`)
  return { where, mux, panes, tab }
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
