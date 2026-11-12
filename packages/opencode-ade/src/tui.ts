// App part of the ADE plugin: it runs in the OpenCode app inside each
// multiplexer pane, so its environment names that pane for certain. It carries
// out the server part's requests for the conversation this pane shows,
// including those of its subagents (they act for their parent): show_file
// here, through ade-kit's open; delegate and status through wt-core. (The
// agent statuses on the tabs come from the status plugin,
// packages/opencode-ade-status.)
import { execFile } from "node:child_process"
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createRoot } from "solid-js"
import { open } from "../../ade-kit/src/actions.ts"
import { makeKit } from "../../ade-kit/src/kit.ts"
import { located } from "../../ade-kit/src/workspace.ts"
import { serverDigest } from "./digest.ts"
import { environmentFor } from "./environment.ts"
import { Ade } from "./rpc.ts"

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
type Result = { ok: boolean; stdout: string; stderr: string }

// The only command a request may run, by action (show_file runs none).
const COMMANDS: Record<string, string> = { delegate: "wt-core", status: "wt-core" }

export default Plugin.define({
  id: "local.ade",
  setup(context) {
    const ade = context.client.rpc(Ade)

    // The OpenCode service can go on running old server code after the files
    // change: it reloads a changed package plugin, but not after a failed
    // reload, and it never reloaded the symlinked file this plugin once was.
    const warn = (message: string) =>
      context.ui.toast.show({ variant: "warning", title: "ADE plugin", message, duration: 15_000 })
    const stale = "The OpenCode service runs an older version of this plugin. Run `opencode service restart` " +
      "(it interrupts running conversations)."
    const checkServer = async () => {
      const expected = serverDigest()
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
      warn("The plugin's server part (packages/opencode-ade) is not running; see the OpenCode log.")
    }
    void checkServer()

    const env = process.env
    // The ADE config is read each time, so a change applies at once.
    const kit = () => makeKit({ env })

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
      new Promise<Result>((done) => {
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

    // In this pane's tab; the server part made the paths absolute.
    const showFile = async (request: Request): Promise<Result> => {
      await open(kit(), request.args, { env, cwd: request.cwd })
      return { ok: true, stdout: "", stderr: "" }
    }

    const handle = async (request: Request) => {
      const command = COMMANDS[request.action]
      if ((!command && request.action !== "show_file") || !(await shows(request.sessionID))) return
      const { granted } = (await ade.claim({ id: request.id })) as { granted: boolean }
      if (!granted) return
      let result: Result = { ok: false, stdout: "", stderr: "" }
      try {
        if (!command) result = await showFile(request)
        else result = request.copy ? await runOnCopy(command, request, request.copy) : await run(command, request)
      } catch (error) {
        result.stderr = (error as { message?: string })?.message ?? JSON.stringify(error)
      }
      await ade.finish({ id: request.id, ...result })
    }

    // Give each conversation this pane shows the environment instructions,
    // once the server has it (a new conversation is shown just before).
    const attach = async (sessionID: string) => {
      const instructions = await environmentFor(kit())
      if (!instructions) return
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          return await ade.attach({ sessionID, instructions })
        } catch {
          await new Promise((done) => setTimeout(done, 1_000))
        }
      }
    }

    const follow = () => {
      const unsubscribe = ade.events.on("request", (event) => {
        void handle(event.data as Request).catch((error) => {
          context.ui.toast.show({ variant: "error", title: "ADE plugin", message: String(error?.message ?? error) })
        })
      })
      const stopAttaching = createRoot((dispose) => {
        const shown = createMemo(() => {
          const route = context.ui.router.current()
          return route.type === "session" && context.data.session.get(route.sessionID) ? route.sessionID : undefined
        })
        createEffect(() => {
          const sessionID = shown()
          if (sessionID) void attach(sessionID).catch(() => {})
        })
        return dispose
      })
      return () => {
        unsubscribe()
        stopAttaching()
      }
    }

    // Only an OpenCode in a pane of the configured multiplexer acts for its
    // conversations and gives them the instructions.
    let stop: (() => void) | undefined
    let stopped = false
    located(kit(), env).then(
      (at) => {
        if (at && !stopped) stop = follow()
      },
      (error) => warn(`The ADE config can't be used: ${error?.message ?? error}`),
    )
    return () => {
      stopped = true
      stop?.()
    }
  },
})
