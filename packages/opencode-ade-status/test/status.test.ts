import assert from "node:assert/strict"
import { test } from "node:test"
import { clip, type Conversation, follower, rootOf } from "../src/status.ts"

type State = Omit<Conversation, "settled"> & { settled?: boolean }

// A follower over conversations whose state the test changes (settled unless
// said otherwise).
const following = (start: Record<string, State>) => {
  const conversations = { ...start }
  const follow = follower((id) => ({ settled: true, ...(conversations[id] ?? { activity: "idle" }) }))
  return { conversations, follow }
}

test("the root record: waiting beats working beats idle", () => {
  assert.equal(rootOf(["idle", "working", "blocked"]), "blocked")
  assert.equal(rootOf(["working", "idle"]), "working")
  assert.equal(rootOf(["idle"]), "idle")
  assert.equal(rootOf([]), "idle")
})

test("work that ends is done, with the conversation's title", () => {
  const { conversations, follow } = following({ a: { activity: "working", title: "Fix the build" } })
  assert.equal(follow(["a"]), undefined)
  conversations.a = { activity: "idle", title: "Fix the build" }
  assert.deepEqual(follow(["a"]), { state: "done", title: "Fix the build" })
  assert.equal(follow(["a"]), undefined) // once
})

test("waiting for you, then idle, is done too", () => {
  const { conversations, follow } = following({ a: { activity: "blocked" } })
  follow(["a"])
  conversations.a = { activity: "idle" }
  assert.deepEqual(follow(["a"]), { state: "done" })
})

test("a failed or interrupted conversation is an error", () => {
  for (const outcome of ["failed", "interrupted"]) {
    const { conversations, follow } = following({ a: { activity: "working" } })
    follow(["a"])
    conversations.a = { activity: "idle", outcome }
    assert.deepEqual(follow(["a"]), { state: "error" })
  }
})

test("the ending waits for the conversation's outcome to come in", () => {
  // OpenCode's app learns that the conversation went idle before its new
  // outcome; until then the record still has the previous turn's.
  const { conversations, follow } = following({ a: { activity: "working", outcome: "succeeded" } })
  follow(["a"])
  conversations.a = { activity: "idle", outcome: "succeeded", settled: false }
  assert.equal(follow(["a"]), undefined)
  assert.equal(follow(["a"]), undefined)
  conversations.a = { activity: "idle", outcome: "interrupted" }
  assert.deepEqual(follow(["a"]), { state: "error" })
})

test("a conversation that starts again before its outcome came in keeps going", () => {
  const { conversations, follow } = following({ a: { activity: "working" } })
  follow(["a"])
  conversations.a = { activity: "idle", settled: false }
  assert.equal(follow(["a"]), undefined)
  conversations.a = { activity: "working" }
  assert.equal(follow(["a"]), undefined)
  conversations.a = { activity: "idle", outcome: "succeeded" }
  assert.deepEqual(follow(["a"]), { state: "done" })
})

test("an idle pane that never worked reports nothing", () => {
  const { follow } = following({ a: { activity: "idle", outcome: "failed" } })
  assert.equal(follow(["a"]), undefined)
  assert.equal(follow([]), undefined)
})

test("nothing ends while another conversation of the pane still works", () => {
  const { conversations, follow } = following({ a: { activity: "working" }, b: { activity: "working" } })
  follow(["a", "b"])
  conversations.a = { activity: "idle", outcome: "failed" }
  assert.equal(follow(["a", "b"]), undefined)
  conversations.b = { activity: "idle", title: "B" }
  // Both were at work since the root was last idle: one failed, and there is
  // no single title.
  assert.deepEqual(follow(["a", "b"]), { state: "error" })
})

test("a conversation that leaves the pane while at work did not end", () => {
  const { conversations, follow } = following({ a: { activity: "working" }, b: { activity: "idle" } })
  follow(["a"])
  assert.equal(follow(["b"]), undefined) // b shown instead, a still works
  conversations.a = { activity: "idle" }
  assert.equal(follow(["b"]), undefined)
})

test("a conversation that ends as it leaves the pane did end", () => {
  const { conversations, follow } = following({ a: { activity: "working" } })
  follow(["a"])
  conversations.a = { activity: "idle", outcome: "interrupted" }
  assert.deepEqual(follow([]), { state: "error" })
})

test("titles are one line within the byte limit", () => {
  assert.equal(clip("  two\nlines\t here ", 192), "two lines here")
  assert.equal(clip(" \n ", 192), undefined)
  assert.equal(clip(undefined, 192), undefined)
  assert.equal(clip("é".repeat(100), 192), `${"é".repeat(94)}…`)
  assert.ok(new TextEncoder().encode(clip("x".repeat(300), 192)).byteLength <= 192)
})
