// App part of the status plugin: it runs in the OpenCode app inside each
// multiplexer pane, so its environment names that pane for certain. It shows
// what this pane's conversation (with its subagents) is doing on the pane's
// tab (with Zellij, an icon in front of the tab's name), agreeing with the
// tab's other OpenCode panes through the server part, which then shows the
// totals. "done" and "failed" last until you visit the tab; they are not shown
// when the tab is active as the work ends.
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createRoot } from "solid-js"
import { makeKit } from "../../ade-kit/src/kit.ts"
import { isActive, topMark } from "../../ade-kit/src/multiplexer.ts"
import type { Mark, Where } from "../../ade-kit/src/types.ts"
import { located } from "../../ade-kit/src/workspace.ts"
import { serverDigest } from "./digest.ts"
import { AdeStatus } from "./rpc.ts"

export default Plugin.define({
  id: "local.ade-status",
  setup(context) {
    const status = context.client.rpc(AdeStatus)

    // A running OpenCode service keeps the server part it first loaded (it does
    // not reload symlinked plugins), so after the files change it runs old code.
    const warn = (message: string) =>
      context.ui.toast.show({ variant: "warning", title: "ADE plugin", message, duration: 15_000 })
    const stale = "The OpenCode service runs an older version of the ADE status plugin. Run `opencode service " +
      "restart` (it interrupts running conversations)."
    const checkServer = async () => {
      const expected = serverDigest()
      if (!expected) return
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          const { digest } = (await status.info({})) as { digest: string }
          if (digest === expected) return
          if (attempt >= 2) return warn(stale) // once more, in case it was reloading
        } catch (error) {
          if ((error as { type?: string })?.type === "rpc.method_not_found") return warn(stale)
          // rpc.unavailable: the server part may still be loading.
        }
        await new Promise((done) => setTimeout(done, 2_000))
      }
      warn("The ADE status plugin's server part is not running; see the OpenCode log.")
    }
    void checkServer()

    // This pane's multiplexer and its place in it, from the ADE config (read
    // each time, so a change applies at once).
    const env = process.env
    const locate = () => located(makeKit(), env)

    const follow = (where: Where) => {
      let tabID: string | undefined
      let mark: Mark = "none"
      const syncTab = async () => {
        const at = await locate()
        if (!at?.mux.markTab) return
        const panes = await at.mux.panes()
        const me = panes.find((pane) => pane.id === where.pane)
        if (!me) return
        tabID = me.tab
        const report = { session: where.session, pane: where.pane, mark }
        const { marks } = (await status.tab_state(report)) as { marks: Record<string, Mark> }
        await at.mux.markTab(me.tab, topMark(panes.filter((pane) => pane.tab === me.tab).map((pane) => marks[pane.id])))
      }
      let synced = Promise.resolve()
      let visitTimer: ReturnType<typeof setInterval> | undefined
      const setMark = (next: Mark, force = false) => {
        if (next === mark && !force) return
        mark = next
        // Then the totals, counted from all tabs by the server part.
        synced = synced
          .then(syncTab)
          .then(() => status.totals({ session: where.session, pane: where.pane }))
          .catch(() => {})
        // Zellij doesn't tell programs about tab switches: while "done" or
        // "failed" shows, check every few seconds whether the tab is active.
        const unseen = mark === "done" || mark === "failed"
        if (unseen && !visitTimer) visitTimer = setInterval(() => void seen(), 3_000)
        if (!unseen && visitTimer) {
          clearInterval(visitTimer)
          visitTimer = undefined
        }
      }
      const tabActive = async () => {
        if (tabID === undefined) return false
        const at = await locate()
        return at ? isActive(await at.mux.tabs(), tabID) : false
      }
      const seen = async () => {
        if ((mark === "done" || mark === "failed") && (await tabActive().catch(() => false))) setMark("none")
      }
      const onFocus = () => {
        if (mark === "done" || mark === "failed") setMark("none")
      }
      context.renderer.on("focus", onFocus)
      setMark("none", true) // a restored tab may still carry an old icon

      const stopFollowing = createRoot((dispose) => {
        // The conversation this pane shows, once the server has it.
        const shown = createMemo(() => {
          const route = context.ui.router.current()
          return route.type === "session" && context.data.session.get(route.sessionID) ? route.sessionID : undefined
        })
        const activity = createMemo(() => {
          const sessionID = shown()
          if (!sessionID) return "none"
          const session = context.data.session
          const ids = [...new Set([sessionID, ...session.family(sessionID)])]
          const asks = (id: string) => (session.permission.list(id)?.length ?? 0) + (session.form.list(id)?.length ?? 0) > 0
          if (ids.some(asks)) return "waiting"
          if (ids.some((id) => session.status(id) === "running")) return "working"
          const outcome = (session.get(sessionID) as { outcome?: string } | undefined)?.outcome
          return outcome === "failed" || outcome === "interrupted" ? "failed" : "idle"
        })
        let previous = { sessionID: undefined as string | undefined, activity: "none" }
        createEffect(() => {
          const now = { sessionID: shown(), activity: activity() }
          const was = previous.sessionID === now.sessionID ? previous.activity : "none"
          previous = now
          if (now.activity === "working" || now.activity === "waiting") return setMark(now.activity)
          if (now.activity === "none" || was === "none") return setMark("none")
          if (was === "working" || was === "waiting") {
            const result = now.activity === "failed" ? "failed" : "done"
            void tabActive()
              .catch(() => false)
              .then((active) => setMark(active ? "none" : result))
          }
        })
        return dispose
      })
      return () => {
        stopFollowing()
        context.renderer.off("focus", onFocus)
        if (visitTimer) clearInterval(visitTimer)
        setMark("none")
      }
    }

    let stop: (() => void) | undefined
    let ended = false
    void locate()
      .then((at) => {
        if (at && !ended) stop = follow(at.where)
      })
      .catch((error) => warn(`The ADE status plugin can't start: ${error?.message ?? error}`))
    return () => {
      ended = true
      stop?.()
    }
  },
})
