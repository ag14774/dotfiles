// The OpenCode app reports to its terminal what its conversations are doing
// (OSC 7501: working, or waiting for you); this plugin adds how their work
// ended, "done" or "error", which OpenCode doesn't report yet (issue #60411).
// Zellij 0.46 shows these statuses (ade-zjstatus draws them in the bar) and
// clears "done" and "error" once you have seen the pane; any terminal that
// understands OSC 7501 can use them.
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createRoot } from "solid-js"
import type { Activity, Conversation, Ending } from "./status.ts"
import { follower, rootOf } from "./status.ts"

// The parts of a conversation's record read here: how its last turn ended,
// and when it last started and stopped working.
type Info = { outcome?: string; title?: string; time?: { busy?: number; idle?: number } }

export default Plugin.define({
  id: "local.ade-status",
  setup(context) {
    const renderer = context.renderer
    if (typeof renderer.setProgramStatus !== "function") return // an OpenCode without OSC 7501
    const session = context.data.session

    // As OpenCode works out its own report: a conversation with its subagents
    // waits when one of them asks for a permission or an answer, and works
    // while one runs or has work queued.
    const family = (id: string) => {
      const root = session.root(id)
      const members = session.family(root)
      return members.includes(root) ? members : [root, ...members]
    }
    const activity = (id: string): Activity => {
      const members = family(id)
      const asks = (member: string) =>
        (session.permission.list(member)?.length ?? 0) + (session.form.list(member)?.length ?? 0) > 0
      if (members.some(asks)) return "blocked"
      const works = (member: string) =>
        session.status(member) === "running" || session.pending.list(member).some((item) => item.type !== "synthetic")
      return members.some(works) ? "working" : "idle"
    }
    const conversation = (id: string): Conversation => {
      const info = session.get(session.root(id)) as Info | undefined
      const settled = !((info?.time?.busy ?? 0) > (info?.time?.idle ?? 0))
      return { activity: activity(id), settled, outcome: info?.outcome, title: info?.title }
    }

    // The ending replaces OpenCode's own "idle" in the root record, so it is
    // written just after OpenCode has written that, and only while the root is
    // still idle. OpenCode's next report (when work starts again) replaces it.
    const report = (ids: () => readonly string[], ending: Ending) =>
      setTimeout(() => {
        if (rootOf(ids().map(activity)) !== "idle") return
        try {
          renderer.setProgramStatus({ ...ending, app: "opencode" })
        } catch {
          // An invalid report throws; the pane then keeps OpenCode's "idle".
        }
      }, 100)

    return createRoot((dispose) => {
      // OpenCode's conversations: its session tabs and the one it shows.
      const ids = createMemo(() => {
        const route = context.ui.router.current()
        const tabs = context.ui.tabs.enabled() ? context.ui.tabs.list().map((tab) => tab.sessionID) : []
        const shown = route.type === "session" && route.sessionID !== "dummy" ? [session.root(route.sessionID)] : []
        return [...new Set([...tabs, ...shown])]
      })
      const follow = follower(conversation)
      createEffect(() => {
        const ending = follow(ids())
        if (ending) report(ids, ending)
      })
      return dispose
    })
  },
})
