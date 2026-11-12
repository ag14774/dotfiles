import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DEFAULTS } from "../src/config.ts"
import { callerDir, isActive, paneWith, tabOf, tabsIn } from "../src/multiplexer.ts"
import { parsePanes, parseTabs } from "../src/multiplexers/zellij.ts"
import type { Pane } from "../src/types.ts"

// A Zellij session: tab 0 in /work/A (main, opencode, editor, a stopped pane
// that has focus, a floating review pane in /work/B), tab 1 in /work/B.
const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8")
const panes = parsePanes(fixture("zellij-list-panes.json"), DEFAULTS.zellij.panes)
const tabs = parseTabs(fixture("zellij-list-tabs.json"))

const pane = (id: string, tab: string, cwd: string | undefined, more: Partial<Pane> = {}): Pane => ({
  id,
  tab,
  ...(cwd ? { cwd } : {}),
  running: true,
  floating: false,
  focused: false,
  ...more,
})

test("tabOf, paneWith and isActive", () => {
  assert.equal(tabOf(panes, "4"), "0")
  assert.equal(tabOf(panes, "5"), "1")
  assert.equal(tabOf(panes, "99"), undefined)
  assert.equal(paneWith(panes, "0", "editor")?.id, "2")
  assert.equal(paneWith(panes, "0", "agent")?.id, "1")
  assert.equal(paneWith(panes, "1", "agent"), undefined)
  assert.equal(isActive(tabs, "1"), true)
  assert.equal(isActive(tabs, "0"), false)
  assert.equal(isActive(tabs, "7"), false)
})

test("callerDir: the tab's focused tiled pane, else its agent pane, else its shell pane", () => {
  // From the floating review pane: the focused tiled pane has stopped (no
  // directory), so the OpenCode pane's.
  assert.equal(callerDir(panes, { session: "s", pane: "4" }), "/work/A")
  assert.equal(callerDir(panes, { session: "s", pane: "5" }), "/work/B")
  const tab = [
    pane("1", "0", "/shell", { role: "shell" }),
    pane("2", "0", "/agent", { role: "agent" }),
    pane("3", "0", "/editor", { role: "editor" }),
    pane("4", "0", "/floating", { floating: true, focused: true }),
    pane("5", "1", "/other", { focused: true }),
  ]
  assert.equal(callerDir(tab, { session: "s", pane: "4" }), "/agent")
  assert.equal(callerDir(tab.map((p) => (p.id === "3" ? { ...p, focused: true } : p)), { session: "s", pane: "4" }), "/editor")
  assert.equal(callerDir(tab.filter((p) => p.id !== "2"), { session: "s", pane: "4" }), "/shell")
  assert.equal(callerDir(tab.filter((p) => p.id === "3" || p.id === "4"), { session: "s", pane: "4" }), undefined)
  assert.equal(callerDir(tab, { session: "s", pane: "9" }), undefined)
})

test("tabsIn: a tab with a running pane inside the worktree and none elsewhere", () => {
  const session = [
    pane("1", "0", "/p/main"),
    pane("2", "0", "/p/main/src"),
    pane("3", "1", "/p/main"),
    pane("4", "1", "/tmp"), // elsewhere: tab 1 is not working in /p/main
    pane("5", "2", "/p/main"),
    pane("6", "2", undefined), // could be anywhere
    pane("7", "3", "/p/main2"), // a sibling with the same prefix
    pane("8", "4", "/p/main"),
    pane("9", "4", undefined, { running: false }), // stopped: ignored
    pane("10", "5", undefined, { running: false }),
  ]
  assert.deepEqual(tabsIn(session, "/p/main", []), [
    { tab: "0", sure: true },
    { tab: "2", sure: false },
    { tab: "4", sure: true },
  ])
  assert.deepEqual(tabsIn(session, "/p/main/", ["/p/main"]), tabsIn(session, "/p/main", []))
  assert.deepEqual(tabsIn(session, "/p/main2", []), [{ tab: "3", sure: true }])
  assert.deepEqual(tabsIn(session, "/nowhere", []), [])
})

test("tabsIn: with nested worktrees, a pane counts only for the deepest one containing it", () => {
  const worktrees = ["/p/main", "/p/main/.worktrees/fix", "/p/other"]
  const session = [
    pane("1", "0", "/p/main"),
    pane("2", "0", "/p/main/src"),
    pane("3", "1", "/p/main/.worktrees/fix"),
    pane("4", "1", "/p/main/.worktrees/fix/src"),
    pane("5", "2", "/p/main"),
    pane("6", "2", "/p/main/.worktrees/fix"), // in both: neither is sure it's theirs
    pane("7", "3", "/p/main/.worktrees"), // the outer worktree's folder
  ]
  assert.deepEqual(tabsIn(session, "/p/main", worktrees), [
    { tab: "0", sure: true },
    { tab: "3", sure: true },
  ])
  assert.deepEqual(tabsIn(session, "/p/main/.worktrees/fix", worktrees), [{ tab: "1", sure: true }])
  // Without the list, the outer worktree would claim the nested one's tab.
  assert.deepEqual(tabsIn(session, "/p/main", []).map((t) => t.tab), ["0", "1", "2", "3"])
})

test("tabsIn lists tabs in numeric order", () => {
  const session = [pane("1", "10", "/w"), pane("2", "2", "/w"), pane("3", "1", "/w")]
  assert.deepEqual(tabsIn(session, "/w", []).map((t) => t.tab), ["1", "2", "10"])
})
