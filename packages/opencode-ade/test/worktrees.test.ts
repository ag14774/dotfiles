import assert from "node:assert/strict"
import { test } from "node:test"
import type { Worktree } from "../src/worktrees.ts"
import { describe, excerpt, stateOf } from "../src/worktrees.ts"

const idle = { time: { busy: 1, idle: 2 } }

test("stateOf: waiting first, then working, failed, interrupted, idle", () => {
  assert.equal(stateOf(idle, undefined, false), "idle")
  assert.equal(stateOf({ time: {} }, undefined, false), "idle")
  assert.equal(stateOf(idle, undefined, true), "waiting for the user")
  assert.equal(stateOf({ time: { busy: 3, idle: 2 } }, undefined, false), "working")
  assert.equal(stateOf({ time: { busy: 3 } }, undefined, false), "working")
  assert.equal(stateOf({ time: { busy: 3 } }, undefined, true), "waiting for the user")
  assert.equal(stateOf({ ...idle, outcome: "failed" }, undefined, false), "failed")
  assert.equal(stateOf(idle, { error: { message: "boom" } }, false), "failed")
  assert.equal(stateOf({ ...idle, outcome: "interrupted" }, undefined, false), "interrupted")
  // A question still open in the last answer (asked before the plugin loaded).
  const asking = { content: [{ type: "tool", name: "question", state: { status: "running" } }] }
  assert.equal(stateOf(idle, asking, false), "waiting for the user")
  assert.equal(stateOf(idle, { content: [{ type: "tool", name: "question", state: { status: "completed" } }] }, false), "idle")
})

test("excerpt: the answer's text on one line, cut with an ellipsis", () => {
  assert.equal(excerpt(undefined), "")
  const answer = { content: [{ type: "text", text: "Done:\n  all  good." }, { type: "tool", name: "x" }, { type: "text", text: "Next?" }] }
  assert.equal(excerpt(answer), "Done: all good. Next?")
  assert.equal(excerpt({ content: [{ type: "text", text: "x".repeat(200) }] }), `${"x".repeat(159)}…`)
  assert.equal(excerpt({ content: [{ type: "text", text: "x".repeat(160) }] }), "x".repeat(160))
})

test("describe: one line per worktree, marking the asking conversation's own", () => {
  const worktree: Worktree = { path: "/p/feat", branch: "feat", base: "origin/HEAD", changed: 2, ahead: 3, behind: 0, tab: "sure" }
  const conversation = { id: "ses_1", state: "working", last: "Running tests" }
  assert.equal(
    describe({ ...worktree, conversation }, "/p/feat/src"),
    '- /p/feat (this conversation): branch feat, 2 changed files, 3 ahead, 0 behind origin/HEAD, tab open; conversation working: "Running tests"',
  )
  assert.equal(
    describe({ ...worktree, branch: null, changed: 1, ahead: null, behind: null, tab: "unsure", conversation: null }, "/p/feature"),
    "- /p/feat: detached HEAD, 1 changed file, tab probably open; no conversation",
  )
  assert.equal(
    describe({ ...worktree, changed: 0, tab: null, conversation: { id: "s", state: "idle" } }, "/p/main"),
    "- /p/feat: branch feat, no changes, 3 ahead, 0 behind origin/HEAD, no tab; conversation idle",
  )
})
