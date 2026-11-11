import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DEFAULTS } from "../src/config.ts"
import { run } from "../src/kit.ts"
import { callerWorkspace, located, sessionOf, workspaceOf } from "../src/workspace.ts"
import type { Config, Kit, Pane } from "../src/types.ts"

const temp = realpathSync(mkdtempSync(join(tmpdir(), "ade-workspace-")))
const repo = join(temp, "repo")
mkdirSync(join(repo, "src"), { recursive: true })
execFileSync("git", ["init", "-q", repo])
const elsewhere = join(temp, "elsewhere")
mkdirSync(elsewhere)

const kitWith = (multiplexer = "none"): Kit => ({ config: { ...structuredClone(DEFAULTS), multiplexer } as Config, run })

test("the derived session name: ade- and 8 hex digits of the path's SHA-1", () => {
  const sha = createHash("sha1").update("/home/me/project").digest("hex")
  assert.equal(sessionOf("/home/me/project"), `ade-${sha.slice(0, 8)}`)
  assert.match(sessionOf("/x"), /^ade-[0-9a-f]{8}$/)
  assert.notEqual(sessionOf("/x"), sessionOf("/y"))
})

test("the workspace is the Git worktree containing the folder", async () => {
  assert.deepEqual(await workspaceOf(kitWith(), join(repo, "src")), { dir: repo, session: sessionOf(repo) })
  assert.equal(await workspaceOf(kitWith(), elsewhere), undefined)
})

// A multiplexer of your own: the caller is in FAKE_PANE, a floating pane in
// tab 0, whose focused tiled pane works in the repository's src folder.
const panes: Pane[] = [
  { id: "1", tab: "0", cwd: join(repo, "src"), running: true, floating: false, focused: true },
  { id: "2", tab: "0", cwd: elsewhere, running: true, floating: true, focused: true },
  { id: "3", tab: "1", cwd: join(temp, "gone"), running: true, floating: false, focused: true },
]
const fake = join(temp, "fake.ts")
writeFileSync(
  fake,
  `export default () => ({
    api: 1,
    name: "fake",
    here: (env) => (env.FAKE_PANE ? { session: "s", pane: env.FAKE_PANE } : undefined),
    connect: () => ({ panes: async () => ${JSON.stringify(panes)}, tabs: async () => [] }),
  })`,
)

test("located: the multiplexer location, when the caller is inside one", async () => {
  const at = await located(kitWith(fake), { FAKE_PANE: "2" })
  assert.deepEqual(at?.where, { session: "s", pane: "2" })
  assert.equal(at?.adapter.name, "fake")
  assert.equal((await at?.mux.panes())?.length, 3)
  assert.equal(await located(kitWith(fake), {}), undefined)
  assert.equal(await located(kitWith("none"), { FAKE_PANE: "2" }), undefined)
})

test("the caller's workspace is that of the pane it was in, else its own folder's", async () => {
  const workspace = { dir: repo, session: sessionOf(repo) }
  assert.deepEqual(await callerWorkspace(kitWith(fake), elsewhere, { FAKE_PANE: "2" }), workspace)
  assert.equal(await callerWorkspace(kitWith(fake), elsewhere, {}), undefined)
  assert.deepEqual(await callerWorkspace(kitWith(fake), join(repo, "src"), {}), workspace)
  // The pane's folder is gone: the caller's own.
  assert.deepEqual(await callerWorkspace(kitWith(fake), repo, { FAKE_PANE: "3" }), workspace)
})
