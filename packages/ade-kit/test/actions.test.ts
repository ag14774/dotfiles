import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { Terminal } from "../src/actions.ts"
import { ADE, fileRef, open, pastes, review, send, tabs as tabsOf, workspace, closeTabs } from "../src/actions.ts"
import { DEFAULTS } from "../src/config.ts"
import { makeKit, run } from "../src/kit.ts"
import type { Config, Key, Multiplexer, Pane, Role, Tab } from "../src/types.ts"

const temp = realpathSync(mkdtempSync(join(tmpdir(), "ade-actions-")))
const dir = join(temp, "work") // not a repository: the workspace is the folder itself
mkdirSync(join(temp, "bin"))
mkdirSync(dir)
writeFileSync(join(dir, "notes.md:12"), "a file whose name ends like a line number\n")
writeFileSync(join(temp, "bin", "hx"), "#!/bin/sh\n")
chmodSync(join(temp, "bin", "hx"), 0o755)
process.env.PATH = `${join(temp, "bin")}:${process.env.PATH}`

// A multiplexer of your own, which hands out the recorder the test sets up.
const fakeMux = join(temp, "fake-mux.ts")
writeFileSync(
  fakeMux,
  `export default () => ({
    api: 1,
    name: "fake",
    label: "Fake",
    here: (env) => (env.FAKE_PANE ? { session: "s", pane: env.FAKE_PANE } : env.FAKE_SESSION ? { session: "s" } : undefined),
    connect: () => globalThis.recorder,
  })`,
)
// An editor that opens files at a line.
const lines = join(temp, "lines.ts")
writeFileSync(
  lines,
  `export default (kit) => kit.typedEditor({
    name: "lines",
    programs: ["hx"],
    open: (f) => [kit.keys.text(JSON.stringify(f))],
    supports: { line: true, reload: "watches" },
  })`,
)

type Call = [string, ...unknown[]]
const pane = (id: string, tab: string, role?: Role, more: Partial<Pane> = {}): Pane => ({
  id,
  tab,
  ...(role ? { role } : {}),
  cwd: dir,
  running: true,
  floating: false,
  focused: false,
  ...more,
})
// You are on tab 1 (shell 1, editor 2, an agent 5 without a known folder).
// Tab 2 has an editor, tab 3 none, tab 4 a stopped one.
const session: Pane[] = [
  pane("1", "1", "shell"),
  pane("2", "1", "editor"),
  pane("5", "1", "agent", { cwd: undefined }),
  pane("3", "2", "shell"),
  pane("4", "2", "editor"),
  pane("6", "3", "shell"),
  pane("7", "4", "shell"),
  pane("8", "4", "editor", { running: false, cwd: undefined }),
]
const tabs: Tab[] = ["1", "2", "3", "4"].map((id) => ({ id, name: id, active: id === "1" }))

const record = (panes: Pane[] = session) => {
  const calls: Call[] = []
  const recorder: Multiplexer = {
    panes: async () => panes,
    tabs: async () => tabs,
    start: async (o) => (calls.push(["start", o]), "9"),
    type: async (pane: string, keys: Key[]) => void calls.push(["type", pane, keys]),
    paste: async (pane: string, text: string) => void calls.push(["paste", pane, text]),
    focus: async (pane: string) => void calls.push(["focus", pane]),
  }
  ;(globalThis as { recorder?: Multiplexer }).recorder = recorder
  return calls
}
const kitWith = (more: Partial<Config> = {}) =>
  makeKit({ config: { ...structuredClone(DEFAULTS), multiplexer: fakeMux, ...more } as Config })
const from = (pane: string | undefined, cwd = dir) => ({ env: pane ? { FAKE_PANE: pane } : {}, cwd })
const typedOpen = (path: string) => [{ key: "escape" }, { text: `:open "${path}"` }, { key: "enter" }]

test("fileRef: paths relative to the caller's folder, with an optional line and column", () => {
  assert.deepEqual(fileRef("a.md", "/w/src"), { path: "/w/src/a.md" })
  assert.deepEqual(fileRef("../a.md:3", "/w/src"), { path: "/w/a.md", line: 3 })
  assert.deepEqual(fileRef("/x/a.md:3:7", "/w"), { path: "/x/a.md", line: 3, column: 7 })
  assert.deepEqual(fileRef("notes.md:12", dir), { path: join(dir, "notes.md:12") }) // that file exists
})

test("open: typed into the editor of the caller's tab, which then gets focus", async () => {
  const calls = record()
  await open(kitWith(), ["notes.md", "/x/b.md"], from("1"))
  assert.deepEqual(calls, [
    ["type", "2", [...typedOpen(join(dir, "notes.md")), ...typedOpen("/x/b.md")]],
    ["focus", "2"],
  ])
  // From the agent pane, whose folder isn't known, the same.
  const again = record()
  await open(kitWith(), ["notes.md"], from("5", "/elsewhere"))
  assert.deepEqual(again, [["type", "2", typedOpen("/elsewhere/notes.md")], ["focus", "2"]])
})

test("open from a tab you are not on: its editor, without focus", async () => {
  const calls = record()
  await open(kitWith(), ["notes.md"], from("3"))
  assert.deepEqual(calls, [["type", "4", typedOpen(join(dir, "notes.md"))]])
})

test("open: a stopped editor is replaced by a fresh one, focused only in the tab you are on", async () => {
  const calls = record()
  await open(kitWith(), ["notes.md"], from("7"))
  const argv = [join(temp, "bin", "hx"), join(dir, "notes.md")]
  assert.deepEqual(calls, [["start", { tab: "4", role: "editor", argv, focus: false, replace: "8" }]])
  const here = record(session.map((p) => (p.id === "2" ? { ...p, running: false } : p)))
  await open(kitWith(), ["notes.md"], from("1"))
  assert.deepEqual(here, [["start", { tab: "1", role: "editor", argv, focus: true, replace: "2" }]])
})

test("open in a tab without an editor: started there if you are on it, else refused", async () => {
  const calls = record(session.filter((p) => p.id !== "2"))
  await open(kitWith(), ["notes.md"], from("1"))
  assert.deepEqual(calls, [["start", { tab: "1", role: "editor", argv: [join(temp, "bin", "hx"), join(dir, "notes.md")], focus: true }]])
  const refused = record()
  await assert.rejects(open(kitWith(), ["notes.md"], from("6")), /^Error: tab 3 has no editor and is not the tab you are on; not switching tabs$/)
  assert.deepEqual(refused, [])
})

test("open refuses, touching nothing, when the caller's pane is gone or it is not inside the multiplexer", async () => {
  const calls = record()
  await assert.rejects(open(kitWith(), ["a"], from("42")), /^Error: pane 42 does not exist; not guessing which tab to use$/)
  await assert.rejects(open(kitWith(), ["a"], from(undefined)), /^Error: not inside Fake$/)
  await assert.rejects(open(kitWith(), ["a"], { env: { FAKE_SESSION: "1" }, cwd: dir }), /^Error: not inside Fake$/)
  await assert.rejects(open(kitWith({ multiplexer: "none" }), ["a"], from("1")), /^Error: Helix is reached through its pane, and no multiplexer is configured$/)
  assert.deepEqual(calls, [])
})

test("open passes lines on to an editor that supports them, and drops them for one that doesn't", async () => {
  const calls = record()
  await open(kitWith({ editor: lines }), ["a.md:3:2", "b.md"], from("1"))
  assert.deepEqual(calls[0], [
    "type",
    "2",
    [{ text: JSON.stringify({ path: join(dir, "a.md"), line: 3, column: 2 }) }, { text: JSON.stringify({ path: join(dir, "b.md") }) }],
  ])
  const dropped = record()
  await open(kitWith(), ["a.md:3"], from("1"))
  assert.deepEqual(dropped[0], ["type", "2", typedOpen(join(dir, "a.md"))])
})

const at = (file: string, more: Partial<{ start: string; end: string; language: string; selection: string }> = {}) => ({
  file,
  selection: "x",
  ...more,
})

test("pastes: the reference, relative to the agent's folder when inside it, with the line range", () => {
  assert.deepEqual(pastes(at("src/a.py", { start: "12", end: "12" }), "/w", "/w"), ["src/a.py:12 "])
  assert.deepEqual(pastes(at("a.py", { start: "3", end: "4" }), "/w", "/w/src"), ["src/a.py:3-4 "])
  assert.deepEqual(pastes(at("a.py", { start: "3" }), "/w", "/elsewhere"), ["/elsewhere/a.py:3 "])
  assert.deepEqual(pastes(at("/w2/a.py"), "/w", "/w"), ["/w2/a.py "]) // a sibling with the same prefix
  assert.deepEqual(pastes(at("a.py"), undefined, "/w"), ["/w/a.py "])
})

test("pastes: a selection of more than one character as a fenced block, then a space", () => {
  assert.deepEqual(pastes(at("a.py", { start: "1", end: "2", language: "python", selection: "def f():\n    pass" }), "/w", "/w"), [
    "a.py:1-2 ",
    "```python\ndef f():\n    pass\n```",
    " ",
  ])
  assert.deepEqual(pastes(at("a.md", { selection: "a\n```\nb" }), "/w", "/w").slice(1), ["````\na\n```\nb\n````", " "])
  assert.deepEqual(pastes(at("a.md", { selection: "\u{1F600}" }), "/w", "/w"), ["a.md "]) // one character
  assert.deepEqual(pastes(at("[scratch]", { selection: "some text", language: "text" }), "/w", "/w"), ["```text\nsome text\n```", " "])
})

test("send: pasted into the agent of the caller's tab, which then gets focus", async () => {
  const calls = record()
  await send(kitWith(), at("notes.md", { start: "2", end: "3", selection: "ab" }), from("2"))
  assert.deepEqual(calls, [
    ["paste", "5", `${join(dir, "notes.md")}:2-3 `], // the agent's folder isn't known
    ["paste", "5", "```\nab\n```"],
    ["paste", "5", " "],
    ["focus", "5"],
  ])
})

test("send --text: inserted as it is, or with submit, pasted then Enter", async () => {
  const inserted = record()
  await send(kitWith(), { text: "1. `a.txt:2` - Why?" }, from("1"))
  assert.deepEqual(inserted, [["paste", "5", "1. `a.txt:2` - Why?"], ["focus", "5"]])
  const submitted = record()
  await send(kitWith(), { text: "comments", submit: true }, from("1"))
  assert.deepEqual(submitted, [["paste", "5", "comments"], ["type", "5", [{ key: "enter" }]], ["focus", "5"]])
})

test("send refuses, touching nothing, without text, an agent pane in the tab, or the caller's pane", async () => {
  const calls = record()
  await assert.rejects(send(kitWith(), { text: "" }, from("1")), /^Error: no text to send$/)
  await assert.rejects(send(kitWith(), at("a.md"), from("3")), /^Error: this tab has no OpenCode pane$/)
  await assert.rejects(send(kitWith(), at("a.md"), from("42")), /^Error: pane 42 does not exist/)
  await assert.rejects(send(kitWith({ multiplexer: "none" }), at("a.md"), from("1")), /^Error: OpenCode is reached through its pane, and no multiplexer is configured$/)
  assert.deepEqual(calls, [])
})

// For review: a clone whose branch has a commit, and a clone with nothing to
// review; tab 1's panes work in the first.
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim()
git(temp, "init", "-q", "--bare", "origin.git")
git(temp, "clone", "-q", join(temp, "origin.git"), "clean")
const clean = join(temp, "clean")
writeFileSync(join(clean, "a.txt"), "one\n")
git(clean, "add", "a.txt")
git(clean, "commit", "-qm", "base")
git(clean, "push", "-q", "origin", "HEAD")
git(clean, "remote", "set-head", "origin", "--auto")
git(temp, "clone", "-q", join(temp, "origin.git"), "branch")
const branch = join(temp, "branch")
const base = git(branch, "rev-parse", "HEAD")
git(branch, "switch", "-qc", "agent")
writeFileSync(join(branch, "a.txt"), "two\n")
git(branch, "commit", "-qam", "agent work")

// Tab 1 works in `branch`; you press the key in its floating pane 10.
const reviewing = (more: Pane[] = []) => [
  ...session.filter((p) => p.tab !== "1"),
  pane("1", "1", "shell", { cwd: branch }),
  pane("5", "1", "agent", { cwd: branch }),
  pane("10", "1", "review", { floating: true, focused: true, cwd: temp }),
  ...more,
]
// A terminal that records what it runs and shows; the reviewer prints `output`.
const terminal = (output: string | { error: string } = "") => {
  const seen: unknown[][] = []
  const recorded: Terminal = {
    interact: async (argv, o) => {
      seen.push(["interact", argv, o.cwd, o.env.EDITOR])
      return typeof output === "string" ? { stdout: output } : { stdout: "", error: output.error }
    },
    pause: async (message) => void seen.push(["pause", message]),
  }
  return { recorded, seen }
}
const editorVariable = `'${ADE}' open`

test("review: the reviewer on the worktree of the pane you were in; its comments filled in for the agent", async () => {
  const calls = record(reviewing())
  const { recorded, seen } = terminal("1. `a.txt:1` - Why?\n\n")
  await review(kitWith(), from("10", temp), recorded)
  assert.deepEqual(seen, [["interact", ["tuicr", "-r", `${base}..HEAD`, "--stdout"], branch, editorVariable]])
  assert.deepEqual(calls, [["paste", "5", "1. `a.txt:1` - Why?"], ["focus", "5"]])
})

test("review: with review.deliver submit, the comments are sent; with no comments, nothing", async () => {
  const calls = record(reviewing())
  await review(kitWith({ review: { deliver: "submit" } }), from("10", temp), terminal("comments\n").recorded)
  assert.deepEqual(calls, [["paste", "5", "comments"], ["type", "5", [{ key: "enter" }]], ["focus", "5"]])
  const none = record(reviewing())
  await review(kitWith(), from("10", temp), terminal("").recorded)
  assert.deepEqual(none, [])
})

test("review: one per tab; a second shows the open one", async () => {
  const calls = record(reviewing([pane("11", "1", "review", { floating: true, cwd: temp })]))
  const { recorded, seen } = terminal()
  await review(kitWith(), from("10", temp), recorded)
  assert.deepEqual([calls, seen], [[["focus", "11"]], []])
  // A stopped one doesn't count, nor one in another tab.
  const others = record(reviewing([pane("11", "1", "review", { running: false }), pane("12", "2", "review")]))
  await review(kitWith(), from("10", temp), terminal().recorded)
  assert.deepEqual(others, [])
})

test("review: nothing to review is said, and waits for a key", async () => {
  record(reviewing().map((p) => (p.tab === "1" && p.cwd === branch ? { ...p, cwd: clean } : p)))
  const { recorded, seen } = terminal()
  await review(kitWith(), from("10", temp), recorded)
  assert.deepEqual(seen, [["pause", `Nothing to review in ${clean}: no commits since origin/HEAD and no uncommitted changes.`]])
  const plain = terminal()
  await review(kitWith({ multiplexer: "none" }), from(undefined, dir), plain.recorded)
  assert.deepEqual(plain.seen, [["pause", `Nothing to review: ${dir} is not in a Git repository.`]])
})

test("review: comments that can't reach the agent are shown, and so is a reviewer that won't start", async () => {
  record(reviewing().filter((p) => p.id !== "5"))
  const { recorded, seen } = terminal("1. Why?\n")
  await review(kitWith(), from("10", temp), recorded)
  assert.deepEqual(seen.at(-1), ["pause", "1. Why?\n\nThe comments above could not be sent: this tab has no OpenCode pane."])
  // Outside the multiplexer it reviews this folder, and can't send.
  const outside = terminal("1. Why?")
  await review(kitWith(), from(undefined, branch), outside.recorded)
  assert.deepEqual(outside.seen.at(-1), ["pause", "1. Why?\n\nThe comments above could not be sent: not inside Fake."])
  record(reviewing())
  const missing = terminal({ error: "spawn tuicr ENOENT" })
  await review(kitWith(), from("10", temp), missing.recorded)
  assert.deepEqual(missing.seen.at(-1), ["pause", "Could not run tuicr: spawn tuicr ENOENT"])
})

// For the actions on tabs: a plain clone with a worktree nested inside it, as
// `wt` makes in a repository that isn't in the worktree layout.
git(temp, "clone", "-q", join(temp, "origin.git"), "outer")
const outer = join(temp, "outer")
git(outer, "worktree", "add", "-q", "-b", "inner", "inner")
const inner = join(outer, "inner")
// Tab 1 works in outer, tab 2 in inner, tab 3 in outer with an agent that
// hasn't said where it is, tab 4 in both; tab 5 is stopped panes only.
const nested: Pane[] = [
  pane("1", "1", "shell", { cwd: outer }),
  pane("2", "2", "shell", { cwd: join(inner, "src") }),
  pane("3", "2", "agent", { cwd: inner }),
  pane("4", "3", "shell", { cwd: join(outer, "src") }),
  pane("5", "3", "agent", { cwd: undefined }),
  pane("6", "4", "shell", { cwd: outer }),
  pane("7", "4", "agent", { cwd: inner }),
  pane("8", "5", "shell", { cwd: undefined, running: false }),
]
const counted = () => {
  const commands: string[][] = []
  const kit = makeKit({
    config: { ...structuredClone(DEFAULTS), multiplexer: fakeMux } as Config,
    run: (argv, o) => (commands.push(argv), run(argv, o)),
  })
  return { kit, commands }
}

test("tabs: the tabs working in each worktree, a nested worktree's not counted for the outer one", async () => {
  record(nested)
  const { kit, commands } = counted()
  assert.deepEqual(await tabsOf(kit, [outer, "outer/inner", join(temp, "elsewhere")], { env: { FAKE_PANE: "1" }, cwd: temp }), {
    [outer]: [{ tab: "1", sure: true }, { tab: "3", sure: false }],
    "outer/inner": [{ tab: "2", sure: true }],
    [join(temp, "elsewhere")]: [],
  })
  // One look at the worktrees per repository.
  assert.equal(commands.filter((argv) => argv.includes("worktree")).length, 2)
})

test("tabs works with the multiplexer's session alone, and not outside one", async () => {
  record(nested)
  assert.deepEqual(await tabsOf(kitWith(), [inner], { env: { FAKE_SESSION: "1" }, cwd: temp }), { [inner]: [{ tab: "2", sure: true }] })
  await assert.rejects(tabsOf(kitWith(), [inner], from(undefined)), /^Error: not inside Fake$/)
  await assert.rejects(tabsOf(kitWith({ multiplexer: "none" }), [inner], from("1")), /^Error: there are no tabs without a multiplexer/)
})

// A multiplexer with tabs for worktrees: openTab adds a tab with a shell and
// (unless `agent` is false) an agent pane in the folder, as the layout does.
const withTabs = (panes: Pane[], o: { agent?: boolean; fail?: "openTab" | "start" | "closeTab" } = {}) => {
  const calls: Call[] = []
  const state = [...panes]
  const recorder: Multiplexer = {
    panes: async () => state,
    tabs: async () => tabs,
    start: async (s) => {
      calls.push(["start", s])
      if (o.fail === "start") throw new Error("boom")
      return "99"
    },
    type: async () => {},
    paste: async () => {},
    focus: async () => {},
    openTab: async (t) => {
      calls.push(["openTab", t])
      if (o.fail === "openTab") throw new Error("boom")
      state.push(pane("20", "9", "shell", { cwd: t.dir }), ...(o.agent === false ? [] : [pane("21", "9", "agent", { cwd: t.dir })]))
      return "9"
    },
    showTab: async (tab) => void calls.push(["showTab", tab]),
    closeTab: async (tab) => {
      calls.push(["closeTab", tab])
      if (o.fail === "closeTab") throw new Error("boom")
    },
  }
  ;(globalThis as { recorder?: Multiplexer }).recorder = recorder
  return calls
}
writeFileSync(join(temp, "bin", "opencode-pane"), "#!/bin/sh\n")
chmodSync(join(temp, "bin", "opencode-pane"), 0o755)
const viaPane = { opencode: { command: ["opencode-pane"] } } as Partial<Config>
// A script with only the session (wt-core's callers may not have a pane).
const scripted = { env: { FAKE_SESSION: "1", PATH: process.env.PATH }, cwd: temp }
const told = () => {
  const messages: string[] = []
  return { messages, tell: (message: string) => void messages.push(message) }
}

test("workspace: the worktree's tab, gone to or left in the background; a tab not sure of its panes counts", async () => {
  const calls = withTabs(nested)
  const { messages, tell } = told()
  assert.deepEqual(await workspace(kitWith(), { dir: inner, focus: true }, scripted, tell), { tab: "2", opened: false })
  assert.deepEqual(await workspace(kitWith(), { dir: "outer", focus: false }, scripted, tell), { tab: "1", opened: false })
  assert.deepEqual(calls, [["showTab", "2"]])
  assert.deepEqual(messages, ["outer already has a tab"])
  const unsure = withTabs(nested.filter((p) => p.tab === "3"))
  await workspace(kitWith(), { dir: outer, focus: true }, scripted)
  assert.deepEqual(unsure, [["showTab", "3"]])
})

test("workspace: a new tab, in front or in the background, also for a worktree with a nested one's tab", async () => {
  const calls = withTabs(nested.filter((p) => p.tab === "2"))
  const { messages, tell } = told()
  assert.deepEqual(await workspace(kitWith(), { dir: outer, focus: true }, scripted, tell), { tab: "9", opened: true })
  assert.deepEqual(calls, [["openTab", { dir: outer, focus: true }]])
  assert.deepEqual(messages, [])
  const background = withTabs([])
  await workspace(kitWith(), { dir: `${inner}/`, focus: false }, scripted, tell)
  assert.deepEqual(background, [["openTab", { dir: inner, focus: false }]])
  assert.deepEqual(messages, ["opened tab inner in the background"])
})

test("workspace: with a conversation or prompt, the new tab's agent pane is replaced by the agent on them", async () => {
  const calls = withTabs([])
  const { messages, tell } = told()
  await workspace(kitWith(viaPane), { dir: inner, focus: false, session: "ses_1", prompt: "-go on" }, scripted, tell)
  const argv = [join(temp, "bin", "opencode-pane"), "--session", "ses_1", "--prompt", "-go on"]
  assert.deepEqual(calls, [
    ["openTab", { dir: inner, focus: false }],
    ["start", { tab: "9", role: "agent", argv, focus: false, replace: "21", cwd: inner }],
  ])
  assert.deepEqual(messages, ["opened tab inner in the background", "OpenCode in tab inner is working on the prompt"])
})

test("workspace refuses a conversation or prompt for a worktree with a tab, and an agent it can't find", async () => {
  const calls = withTabs(nested)
  await assert.rejects(workspace(kitWith(viaPane), { dir: inner, focus: false, prompt: "go" }, scripted),
    /^Error: inner already has a tab; send the prompt to its OpenCode instead$/)
  await assert.rejects(workspace(kitWith(), { dir: inner, focus: false, session: "ses_1" }, { ...scripted, env: { FAKE_SESSION: "1", PATH: "/nowhere" } }),
    /^Error: OpenCode executable not found \(tried opencode\)$/)
  assert.deepEqual(calls, [])
  // A program given with its path is used as it is.
  const given = withTabs([])
  await workspace(kitWith({ opencode: { command: ["/opt/oc"] } } as Partial<Config>), { dir: inner, focus: true, prompt: "go" }, scripted)
  assert.deepEqual((given[1][1] as { argv: string[] }).argv, ["/opt/oc", "--prompt", "go"])
})

test("workspace says what failed: no tab, no agent pane in it (after a while), the agent not started", async () => {
  withTabs([], { fail: "openTab" })
  await assert.rejects(workspace(kitWith(), { dir: inner, focus: false }, scripted), /^Error: could not open a Fake tab for inner$/)
  withTabs([], { agent: false })
  const { messages, tell } = told()
  await assert.rejects(workspace(kitWith(viaPane), { dir: inner, focus: false, prompt: "go" }, scripted, tell),
    /^Error: no opencode pane in tab inner; prompt not sent \(the tab stays open\)$/)
  assert.deepEqual(messages, ["opened tab inner in the background"])
  withTabs([], { fail: "start" })
  await assert.rejects(workspace(kitWith(viaPane), { dir: inner, focus: false, prompt: "go" }, scripted),
    /^Error: could not start OpenCode with the prompt in tab inner$/)
})

test("workspace needs a multiplexer that opens tabs, and a session", async () => {
  record(nested.filter((p) => p.tab === "2"))
  await assert.rejects(workspace(kitWith(), { dir: outer, focus: true }, scripted), /^Error: the multiplexer "fake" lacks: openTab$/)
  await assert.rejects(workspace(kitWith(), { dir: outer, focus: true }, from(undefined)), /^Error: not inside Fake$/)
})

// Tabs found before the worktree went: 1 and 4 sure, 3 unsure.
const before = [{ tab: "1", sure: true }, { tab: "3", sure: false }, { tab: "4", sure: true }]

test("closeTabs: the tabs found before, except yours and the unsure ones, each told", async () => {
  const calls = withTabs(nested)
  const { messages, tell } = told()
  await closeTabs(kitWith(), "/p/gone", before, from("7"), tell) // you are in tab 4
  assert.deepEqual(calls, [["closeTab", "1"]])
  assert.deepEqual(messages, [
    "closed the tab of gone",
    "left a tab of gone open (Fake did not report where all its panes are)",
    "left the tab of gone open (you are in it)",
  ])
  // Without a list, the tabs working in the folder now.
  const now = withTabs(nested)
  await closeTabs(kitWith(), inner, undefined, from("1"), tell)
  assert.deepEqual(now, [["closeTab", "2"]])
  const none = withTabs([])
  await closeTabs(kitWith(), inner, undefined, from("1"), tell)
  assert.deepEqual(none, [])
})

test("closeTabs closes nothing for the agent's commands or when your tab is unknown; a tab that won't close is a warning", async () => {
  const cases: [Record<string, string>, string][] = [
    [{ FAKE_PANE: "7", OPENCODE_TERMINAL: "1" }, "left the tabs of gone open (OpenCode agents don't close tabs)"],
    [{ FAKE_PANE: "42" }, "left the tabs of gone open (could not tell which tab you are in)"],
    [{ FAKE_SESSION: "1" }, "left the tabs of gone open (could not tell which tab you are in)"],
  ]
  for (const [env, message] of cases) {
    const calls = withTabs(nested)
    const { messages, tell } = told()
    await closeTabs(kitWith(), "/p/gone", before, { env, cwd: temp }, tell)
    assert.deepEqual([calls, messages], [[], [message]])
  }
  const calls = withTabs(nested, { fail: "closeTab" })
  const { messages, tell } = told()
  await closeTabs(kitWith(), "/p/gone", before.slice(0, 1), from("7"), tell)
  assert.deepEqual([calls, messages], [[["closeTab", "1"]], ["warning: could not close the tab of gone"]])
  record(nested)
  await assert.rejects(closeTabs(kitWith(), "/p/gone", before, from("7")), /^Error: the multiplexer "fake" lacks: closeTab$/)
})
