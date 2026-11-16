import assert from "node:assert/strict"
import { test } from "node:test"
import { delegated, delegation } from "../src/delegate.ts"

test("delegation: the worktree command, with the brief as the prompt and the base after the branch", () => {
  assert.deepEqual(delegation("ses_1", { branch: "fix-x", brief: "Fix x." }), {
    args: ["open", "--prompt", "Fix x.", "fix-x"],
  })
  assert.deepEqual(delegation("ses_1", { branch: "fix-x", brief: "Fix x.", base: "develop", context: "none" }), {
    args: ["open", "--prompt", "Fix x.", "fix-x", "develop"],
  })
})

test("delegation with the context: the conversation is copied up to the request, into the worktree made first", () => {
  const full = delegation("ses_1", { branch: "feat", brief: "Go on.", base: "main", context: "full" }, "msg_9")
  assert.ok("args" in full)
  assert.deepEqual(full.copy, {
    sessionID: "ses_1",
    before: "msg_9",
    compact: false,
    prepare: ["open", "--stay", "feat", "main"],
  })
  assert.equal(full.args[0], "open")
  assert.match(
    full.args[2],
    /^This conversation was copied into the worktree for branch feat, .*don't delegate this again\.\n\nGo on\.$/s,
  )
  assert.deepEqual(full.args.slice(3), ["feat", "main"])
  const compact = delegation("ses_1", { branch: "feat", brief: "Go on.", context: "compact" })
  assert.ok("copy" in compact)
  assert.deepEqual(compact.copy, { sessionID: "ses_1", compact: true, prepare: ["open", "--stay", "feat"] })
})

test("delegation refuses names that aren't plain: blank, with spaces, or like options", () => {
  for (const task of [
    { branch: " ", brief: "b" },
    { branch: "two words", brief: "b" },
    { branch: "-t", brief: "b" },
    { branch: "ok", brief: "b", base: "--force" },
    { branch: "ok", brief: "b", base: "a b" },
  ])
    assert.deepEqual(delegation("ses_1", task), {
      error: "Nothing was delegated: branch and base must be names without spaces.",
    })
})

test("delegated: what the agent is told, saying how the conversation went over", () => {
  const task = { branch: "feat", brief: "b" }
  assert.equal(
    delegated(task, "/p/feat"),
    "Opened a background tab for feat (worktree /p/feat); its OpenCode is working on the brief. " +
      "You are not told when it finishes; the user follows it in that tab.",
  )
  assert.match(
    delegated(task, "/p/feat", { sessionID: "s", compact: true, prepare: [] }),
    /in a compacted copy of this conversation\. /,
  )
  assert.match(
    delegated(task, "/p/feat", { sessionID: "s", compact: false, prepare: [] }),
    /in a copy of this conversation\. /,
  )
})
