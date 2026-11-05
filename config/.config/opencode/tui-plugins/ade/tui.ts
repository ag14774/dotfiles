// App part of the ADE plugin: it runs in the OpenCode app inside each Zellij
// pane, so its environment names that pane for certain. It carries out the
// server part's requests for the conversation this pane shows, including those
// of its subagents (they act for their parent).
import { execFile } from "node:child_process"
import { Plugin } from "@opencode/plugin/tui"
import { serverDigest } from "./digest"
import { Ade } from "./rpc"

type Request = { id: string; sessionID: string; action: "show_file"; paths: string[] }

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

    const run = (command: string, args: string[]) =>
      new Promise<{ ok: boolean; message: string }>((done) => {
        execFile(command, args, { env, timeout: 15_000 }, (error, _stdout, stderr) => {
          const detail = String(stderr).trim()
          if (error) done({ ok: false, message: detail || String(error.message) })
          else done({ ok: true, message: detail })
        })
      })

    const handle = async (request: Request) => {
      if (!(await shows(request.sessionID))) return
      const { granted } = (await ade.claim({ id: request.id })) as { granted: boolean }
      if (!granted) return
      let result = { ok: false, message: `Unknown request: ${request.action}` }
      try {
        if (request.action === "show_file") {
          result = await run("hx-open", request.paths)
          if (result.ok) result.message = `Opened ${request.paths.join(", ")} in the user's editor.`
        }
      } catch (error) {
        result = { ok: false, message: String(error) }
      }
      await ade.finish({ id: request.id, ...result })
    }
    const unsubscribe = ade.events.on("request", (event) => {
      void handle(event.data as Request).catch((error) => {
        context.ui.toast.show({ variant: "error", title: "ADE plugin", message: String(error?.message ?? error) })
      })
    })
    return () => unsubscribe()
  },
})
