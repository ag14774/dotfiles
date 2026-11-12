// Pane logic for every multiplexer, on what its panes() and tabs() return.
import type { Pane, Role, Tab, Where } from "./types.ts"

export const tabOf = (panes: readonly Pane[], pane: string) => panes.find((p) => p.id === pane)?.tab
export const paneWith = (panes: readonly Pane[], tab: string, role: Role) =>
  panes.find((p) => p.tab === tab && p.role === role)
export const isActive = (tabs: readonly Tab[], tab: string) => tabs.some((t) => t.id === tab && t.active)

// The directory of the pane you were in: the tab's focused tiled pane, else
// its agent or shell pane. (A floating pane started by a key starts in the
// session's directory, not in that of the pane you were in.)
export function callerDir(panes: readonly Pane[], where: Where): string | undefined {
  const tab = where.pane === undefined ? undefined : tabOf(panes, where.pane)
  if (tab === undefined) return undefined
  const tiled = panes.filter((p) => p.tab === tab && !p.floating && p.cwd !== undefined)
  const pane =
    tiled.find((p) => p.focused) ?? tiled.find((p) => p.role === "agent") ?? tiled.find((p) => p.role === "shell")
  return pane?.cwd
}

const trimmed = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path)
const within = (path: string, root: string) => path === root || path.startsWith(root === "/" ? root : `${root}/`)

// The tabs working in worktree `dir`: a tab with a running pane inside it and
// no pane known to be elsewhere. Directories survive renamed tabs and restored
// sessions, unlike tab names and IDs. A pane counts only for the deepest
// worktree containing it (`worktrees`, the caller's list), so a tab in a
// nested worktree doesn't count for the outer one. Stopped panes are ignored;
// a running pane without a known directory could be anywhere, so its tab is
// not `sure`.
export function tabsIn(panes: readonly Pane[], dir: string, worktrees: readonly string[]) {
  const target = trimmed(dir)
  const roots = [...new Set([...worktrees.map(trimmed), target])]
  const deepest = (path: string) =>
    roots.filter((root) => within(path, root)).reduce((a, b) => (b.length > a.length ? b : a), "")
  const inside = (pane: Pane) => pane.cwd !== undefined && deepest(trimmed(pane.cwd)) === target
  const tabs = new Map<string, Pane[]>()
  for (const pane of panes) if (pane.running) tabs.set(pane.tab, [...(tabs.get(pane.tab) ?? []), pane])
  return [...tabs]
    .filter(([, inTab]) => inTab.some(inside) && inTab.every((pane) => pane.cwd === undefined || inside(pane)))
    .map(([tab, inTab]) => ({ tab, sure: inTab.every((pane) => pane.cwd !== undefined) }))
    .sort((a, b) => a.tab.localeCompare(b.tab, "en", { numeric: true }))
}
