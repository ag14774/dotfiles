import assert from "node:assert/strict"
import { test } from "node:test"
import { countMarks, type Registry, report } from "../src/marks.ts"

test("panes report their marks per session; none removes the pane", () => {
  const registry: Registry = new Map()
  assert.deepEqual(report(registry, "main", "1", "working"), { 1: "working" })
  assert.deepEqual(report(registry, "main", "2", "done"), { 1: "working", 2: "done" })
  assert.deepEqual(report(registry, "other", "1", "waiting"), { 1: "waiting" })
  assert.deepEqual(report(registry, "main", "1", "none"), { 2: "done" })
  assert.deepEqual(report(registry, "main", "2", "none"), {})
  assert.deepEqual([...registry.keys()], ["other"])
})

test("countMarks counts each shown mark", () => {
  assert.deepEqual(countMarks(["done", "none", "working", "done", "failed"]), { waiting: 0, failed: 1, done: 2, working: 1 })
  assert.deepEqual(countMarks([]), { waiting: 0, failed: 0, done: 0, working: 0 })
})
