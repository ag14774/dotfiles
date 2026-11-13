import assert from "node:assert/strict"
import { test } from "node:test"
import { attend, type Notice, type Toast } from "../src/attention.ts"

type Info = { parentID?: string; title?: string; status?: string }

// An app showing `shown` (root conversations), with OpenCode's events sent by
// the test; `builtinOff` says whether the built-in plugin is switched off.
const app = (sessions: Record<string, Info>, shown: string[], builtinOff = true) => {
  const listeners = new Map<string, ((event: { data: any }) => void)[]>()
  const notices: Notice[] = []
  const toasts: Toast[] = []
  const root = (id: string): string => (sessions[id]?.parentID ? root(sessions[id].parentID!) : id)
  const state = { builtinOff }
  const stop = attend(
    {
      on: (type, listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
        return () => listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener))
      },
      session: {
        get: (id) => sessions[id],
        family: (id) => Object.keys(sessions).filter((s) => root(s) === root(id)),
        status: (id) => sessions[id]?.status,
      },
      notify: (notice) => notices.push(notice),
      toast: (toast) => toasts.push(toast),
    },
    { mine: (id) => shown.includes(root(id)), active: () => state.builtinOff },
  )
  const send = (type: string, data: unknown) => (listeners.get(type) ?? []).forEach((l) => l({ data }))
  return { send, notices, toasts, state, stop }
}

const failure = (sessionID: string, message = "boom", type = "provider.error") => ({
  sessionID,
  error: { type, message },
})

test("a turn that ends in a conversation the app shows: done, once, with its title", () => {
  const a = app({ s1: { title: "Fix the build" } }, ["s1"])
  a.send("session.execution.succeeded", { sessionID: "s1" })
  a.send("session.execution.succeeded", { sessionID: "s1" })
  assert.deepEqual(a.notices, [
    {
      title: "Fix the build",
      message: "Session done",
      notification: { when: "blurred" },
      sound: { name: "done", when: "always" },
    },
  ])
  a.send("session.execution.started", { sessionID: "s1" })
  a.send("session.execution.succeeded", { sessionID: "s1" })
  assert.equal(a.notices.length, 2) // the next turn
})

test("conversations the app doesn't show make no sound in it", () => {
  const a = app({ s1: {}, s2: {}, c2: { parentID: "s2" } }, ["s1"])
  a.send("session.execution.succeeded", { sessionID: "s2" })
  a.send("session.execution.succeeded", { sessionID: "c2" })
  a.send("permission.asked", { id: "p1", sessionID: "s2" })
  a.send("form.created", { form: { id: "f1", sessionID: "c2", title: "Pick one" } })
  a.send("session.execution.failed", failure("s2"))
  assert.deepEqual(a.notices, [])
})

test("nothing while the built-in plugin is on, as it plays them itself", () => {
  const a = app({ s1: {} }, ["s1"], false)
  a.send("session.execution.succeeded", { sessionID: "s1" })
  a.send("permission.asked", { id: "p1", sessionID: "s1" })
  a.send("session.execution.failed", failure("s1"))
  assert.deepEqual(a.notices, [])
  assert.deepEqual(a.toasts, [])
  a.state.builtinOff = true // switched off later: from the next event
  a.send("permission.asked", { id: "p2", sessionID: "s1" })
  assert.equal(a.notices.length, 1)
})

test("a subagent of a shown conversation: subagent_done, without a system notification", () => {
  const a = app({ s1: { title: "Main" }, c1: { parentID: "s1", title: "Explore" } }, ["s1"])
  a.send("session.execution.succeeded", { sessionID: "c1" })
  assert.deepEqual(a.notices, [
    { title: "Explore", message: "Session done", notification: false, sound: { name: "subagent_done", when: "always" } },
  ])
})

test("not done while one of its subagents still runs", () => {
  const sessions: Record<string, Info> = { s1: {}, c1: { parentID: "s1", status: "running" } }
  const a = app(sessions, ["s1"])
  a.send("session.execution.succeeded", { sessionID: "s1" })
  assert.deepEqual(a.notices, [])
  sessions.c1.status = "idle"
  a.send("session.execution.succeeded", { sessionID: "s1" })
  assert.equal(a.notices[0]?.sound.name, "done")
})

test("a question and a permission, once per request, until answered", () => {
  const a = app({ s1: { title: "Main" } }, ["s1"])
  a.send("form.created", { form: { id: "f1", sessionID: "s1", title: "Pick one" } })
  a.send("form.created", { form: { id: "f1", sessionID: "s1", title: "Pick one" } })
  a.send("permission.asked", { id: "p1", sessionID: "s1" })
  a.send("permission.asked", { id: "p1", sessionID: "s1" })
  assert.deepEqual(
    a.notices.map((n) => [n.title, n.message, n.sound.name]),
    [
      ["Pick one", "Input needs response", "question"],
      ["Main", "Permission needs input", "permission"],
    ],
  )
  a.send("form.replied", { id: "f1" })
  a.send("permission.replied", { requestID: "p1" })
  a.send("form.created", { form: { id: "f1", sessionID: "s1", title: "Pick one" } })
  a.send("permission.asked", { id: "p1", sessionID: "s1" })
  assert.equal(a.notices.length, 4)
})

test("a failure: the error sound and OpenCode's toast, then no done", () => {
  const a = app({ s1: { title: "Main" }, s2: {} }, ["s1"])
  a.send("session.execution.failed", failure("s1", "Model not found"))
  a.send("session.execution.succeeded", { sessionID: "s1" })
  assert.deepEqual(
    a.notices.map((n) => [n.message, n.sound.name]),
    [["Model not found", "error"]],
  )
  // The toast, as the built-in plugin shows it, in every app.
  a.send("session.execution.failed", failure("s2", "Other"))
  assert.deepEqual(
    a.toasts.map((t) => [t.sessionID, t.title, t.message]),
    [
      ["s1", "Session failed", "Model not found"],
      ["s2", "Session failed", "Other"],
    ],
  )
})

test("a free-plan limit: no error sound, but the toast", () => {
  const a = app({ s1: {} }, ["s1"])
  a.send("session.execution.failed", failure("s1", "Limit reached", "provider.free-limit"))
  assert.deepEqual(a.notices, [])
  assert.equal(a.toasts.length, 1)
})

test("an interrupted turn is done", () => {
  const a = app({ s1: {} }, ["s1"])
  a.send("session.execution.interrupted", { sessionID: "s1" })
  assert.equal(a.notices[0]?.sound.name, "done")
})

test("stopping removes every listener", () => {
  const a = app({ s1: {} }, ["s1"])
  a.stop()
  a.send("session.execution.succeeded", { sessionID: "s1" })
  assert.deepEqual(a.notices, [])
})
