// App part of the ADE plugin: it runs in the OpenCode app inside each Zellij
// pane, so its environment names that pane for certain. It carries out the
// server part's requests for the conversation this pane shows, including those
// of its subagents (they act for their parent).
import { execFile } from "node:child_process"
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createRoot } from "solid-js"
import { serverDigest } from "./digest"
import { Ade } from "./rpc"
import { type Mark, URGENCY, withMark } from "./tabs"

type Copy = { sessionID: string; before?: string; compact: boolean; prepare: string[] }
type Request = {
  id: string
  sessionID: string
  action: string
  args: string[]
  cwd: string
  timeout: number
  copy?: Copy
}

// The only commands a request may run, by action.
const COMMANDS: Record<string, string> = { show_file: "hx-open", delegate: "wt-core", status: "wt-core" }

export default Plugin.define({
  id: "local.ade",
  setup(context) {
    const ade = context.client.rpc(Ade)

    // A running OpenCode service keeps the server part it first loaded (it does
    // not reload symlinked plugins), so after the files change it runs old code.
    const warn = (message: string) =>
      context.ui.toast.show({ variant: "warning", title: "ADE plugin", message, duration: 15_000 })
    const stale = "The OpenCode service runs an older version of this plugin. Run `opencode service restart` " +
      "(it interrupts running conversations)."
    const checkServer = async () => {
      const expected = serverDigest(new URL("../../", import.meta.url))
      if (!expected) return
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          const { digest } = (await ade.info({})) as { digest: string }
          if (digest === expected) return
          if (attempt >= 2) return warn(stale) // once more, in case it was reloading
        } catch (error) {
          if ((error as { type?: string })?.type === "rpc.method_not_found") return warn(stale)
          // rpc.unavailable: the server part may still be loading.
        }
        await new Promise((done) => setTimeout(done, 2_000))
      }
      warn("The plugin's server part (plugins/ade.ts) is not running; see the OpenCode log.")
    }
    void checkServer()

    const env = process.env
    if (!env.ZELLIJ || !env.ZELLIJ_SESSION_NAME || !env.ZELLIJ_PANE_ID) return

    // The conversation a session belongs to: its top-level ancestor.
    const parents = new Map<string, string | undefined>()
    const parentOf = async (sessionID: string) => {
      if (parents.has(sessionID)) return parents.get(sessionID)
      const known = context.data.session.get(sessionID) as { parentID?: string | null } | undefined
      const info = known ?? ((await context.client.session.get({ sessionID }).catch(() => undefined)) as typeof known)
      if (!info) return undefined
      parents.set(sessionID, info.parentID ?? undefined)
      return info.parentID ?? undefined
    }
    const rootOf = async (sessionID: string) => {
      let id = sessionID
      for (let depth = 0; depth < 16; depth++) {
        const parent = await parentOf(id)
        if (!parent) return id
        id = parent
      }
      return id
    }
    const shows = async (sessionID: string) => {
      const route = context.ui.router.current()
      if (route.type !== "session") return false
      return (await rootOf(sessionID)) === (await rootOf(route.sessionID))
    }

    const run = (command: string, request: Request) =>
      new Promise<{ ok: boolean; stdout: string; stderr: string }>((done) => {
        const options = { env, cwd: request.cwd, timeout: request.timeout }
        execFile(command, request.args, options, (error, stdout, stderr) => {
          const message = String(stderr) || (error ? String(error.message) : "")
          done({ ok: !error, stdout: String(stdout), stderr: message })
        })
      })

    // Copy the conversation into the worktree `prepare` creates (compacting the
    // copy if asked), then run the request's command on the copy.
    const runOnCopy = async (command: string, request: Request, copy: Copy) => {
      const prepared = await run(command, { ...request, args: copy.prepare })
      if (!prepared.ok) return prepared
      const client = context.client
      const fork = await client.session.fork({ sessionID: copy.sessionID, before: copy.before })
      try {
        await client.session.move({ sessionID: fork.id, directory: prepared.stdout.trim() })
        if (copy.compact) await client.session.compact({ sessionID: fork.id })
        await client.experimental.session.wait({ sessionID: fork.id })
        const [verb, ...rest] = request.args
        const result = await run(command, { ...request, args: [verb, "--session", fork.id, ...rest] })
        if (!result.ok) await client.session.remove({ sessionID: fork.id }).catch(() => {})
        return result
      } catch (error) {
        await client.session.remove({ sessionID: fork.id }).catch(() => {})
        throw error
      }
    }

    const handle = async (request: Request) => {
      const command = COMMANDS[request.action]
      if (!command || !(await shows(request.sessionID))) return
      const { granted } = (await ade.claim({ id: request.id })) as { granted: boolean }
      if (!granted) return
      let result = { ok: false, stdout: "", stderr: "" }
      try {
        result = request.copy ? await runOnCopy(command, request, request.copy) : await run(command, request)
      } catch (error) {
        result.stderr = (error as { message?: string })?.message ?? JSON.stringify(error)
      }
      await ade.finish({ id: request.id, ...result })
    }
    const unsubscribe = ade.events.on("request", (event) => {
      void handle(event.data as Request).catch((error) => {
        context.ui.toast.show({ variant: "error", title: "ADE plugin", message: String(error?.message ?? error) })
      })
    })

    // The tab icon: what this pane's conversation (with its subagents) is doing,
    // in front of the tab's name. "done" and "failed" last until you visit the
    // tab; they are not shown when the tab is active as the work ends.
    const zellij = (...args: string[]) =>
      new Promise<string>((done, fail) =>
        execFile("zellij", ["--session", env.ZELLIJ_SESSION_NAME!, "action", ...args], { env, timeout: 10_000 },
          (error, stdout) => (error ? fail(error) : done(String(stdout)))),
      )
    let tabID: number | undefined
    let mark: Mark = "none"
    const syncTab = async () => {
      const panes = JSON.parse(await zellij("list-panes", "--json")) as any[]
      const me = panes.find((pane) => !pane.is_plugin && String(pane.id) === env.ZELLIJ_PANE_ID)
      if (!me) return
      tabID = me.tab_id
      const report = { zellij: env.ZELLIJ_SESSION_NAME!, pane: env.ZELLIJ_PANE_ID!, state: mark }
      const { states } = (await ade.tab_state(report)) as { states: Record<string, string> }
      const inTab = panes.filter((pane) => !pane.is_plugin && pane.tab_id === me.tab_id).map((pane) => String(pane.id))
      const top = URGENCY.find((state) => inTab.some((id) => states[id] === state)) ?? "none"
      const tab = (JSON.parse(await zellij("list-tabs", "--json")) as any[]).find((tab) => tab.tab_id === me.tab_id)
      if (!tab) return
      const name = withMark(String(tab.name), top)
      if (name !== tab.name) await zellij("rename-tab-by-id", String(me.tab_id), name)
    }
    let synced = Promise.resolve()
    let visitTimer: ReturnType<typeof setInterval> | undefined
    const setMark = (next: Mark, force = false) => {
      if (next === mark && !force) return
      mark = next
      // Then the top bar's totals, counted from all tab names by the server part.
      synced = synced
        .then(syncTab)
        .then(() => ade.totals({ zellij: env.ZELLIJ_SESSION_NAME! }))
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
      return (JSON.parse(await zellij("list-tabs", "--json")) as any[]).some((tab) => tab.tab_id === tabID && tab.active)
    }
    const seen = async () => {
      if ((mark === "done" || mark === "failed") && (await tabActive().catch(() => false))) setMark("none")
    }
    const onFocus = () => {
      if (mark === "done" || mark === "failed") setMark("none")
    }
    context.renderer.on("focus", onFocus)
    setMark("none", true) // a restored tab may still carry an old icon

    // Give each conversation this pane shows the environment instructions,
    // once the server has it (a new conversation is shown just before).
    const attach = async (sessionID: string) => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          return await ade.attach({ sessionID })
        } catch {
          await new Promise((done) => setTimeout(done, 1_000))
        }
      }
    }
    const stopAttaching = createRoot((dispose) => {
      const shown = createMemo(() => {
        const route = context.ui.router.current()
        return route.type === "session" && context.data.session.get(route.sessionID) ? route.sessionID : undefined
      })
      createEffect(() => {
        const sessionID = shown()
        if (sessionID) void attach(sessionID)
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
      unsubscribe()
      stopAttaching()
      context.renderer.off("focus", onFocus)
      if (visitTimer) clearInterval(visitTimer)
      setMark("none")
    }
  },
})
