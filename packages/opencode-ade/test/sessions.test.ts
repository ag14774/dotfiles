import assert from "node:assert/strict"
import { test } from "node:test"
import { rootOf } from "../src/sessions.ts"

test("rootOf: a subagent's top-level conversation, within a bounded chain", async () => {
  const parents: Record<string, string> = { child: "parent", grandchild: "child", a: "b", b: "a" }
  const parentOf = async (id: string) => parents[id]
  assert.equal(await rootOf("grandchild", parentOf), "parent")
  assert.equal(await rootOf("parent", parentOf), "parent")
  assert.equal(await rootOf("unknown", parentOf), "unknown")
  assert.equal(await rootOf("a", parentOf, 3), "b") // a loop ends after `depth` steps
})
