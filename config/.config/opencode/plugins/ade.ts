// Server part of the ADE plugin (it runs in OpenCode's shared background service).
//
// Agent commands run in this service, not in a pane. A conversation shown in an
// OpenCode pane gets that pane's environment, but one no pane shows falls back to
// the service's own, copied from whichever pane happened to start the service.
// So the Zellij variables are removed from it, and anything that must act in
// "the user's tab" is done by the OpenCode app in the pane showing the
// conversation (tui.ts), which knows its own pane for certain.
import { randomUUID } from "node:crypto"
import { isAbsolute, resolve } from "node:path"
import { Plugin } from "@opencode/plugin"
import { serverDigest } from "../tui-plugins/ade/digest"
import { Ade } from "../tui-plugins/ade/rpc"

type Result = { ok: boolean; message: string }
type Pending = { claimed: boolean; finish: (result: Result) => void }

// The service loads one instance of this plugin per directory, and a pane's app
// may talk to another instance than the conversation's (after /cd, for example).
// Pending requests are therefore shared through the process.
const pending: Map<string, Pending> = ((globalThis as any).__adePending ??= new Map())

// Taken once, when this module is evaluated: a running service keeps evaluated
// code, so this describes what runs even after the files change.
const RUNNING = serverDigest(new URL("../", import.meta.url)) ?? "unknown"

const CLAIM_TIMEOUT_MS = 5_000
const RESULT_TIMEOUT_MS = 20_000

export default Plugin.define({
  id: "local.ade",
  async setup(ctx) {
    for (const name of ["ZELLIJ", "ZELLIJ_SESSION_NAME", "ZELLIJ_PANE_ID"]) delete process.env[name]

    const rpc = await ctx.rpc.register(Ade, {
      info: async () => ({ digest: RUNNING }),
      show_file: async (input, context) => {
        const { sessionID, paths } = input as { sessionID: string; paths: string[] }
        return showFile(sessionID, paths, context.signal)
      },
      claim: async (input) => {
        const request = pending.get((input as { id: string }).id)
        if (!request || request.claimed) return { granted: false }
        request.claimed = true
        return { granted: true }
      },
      finish: async (input) => {
        const { id, ok, message } = input as { id: string } & Result
        pending.get(id)?.finish({ ok, message })
        return {}
      },
    })

    // Ask the pane showing the conversation to act, and wait for its answer.
    const ask = (data: { sessionID: string; action: "show_file"; paths: string[] }, signal: AbortSignal) =>
      new Promise<Result>((resolveResult) => {
        const id = randomUUID()
        const request: Pending = { claimed: false, finish: () => {} }
        const finish = (result: Result) => {
          clearTimeout(claimTimer)
          clearTimeout(resultTimer)
          signal.removeEventListener("abort", cancel)
          if (pending.get(id) !== request) return
          pending.delete(id)
          resolveResult(result)
        }
        const cancel = () => finish({ ok: false, message: "Cancelled." })
        request.finish = finish
        pending.set(id, request)
        const claimTimer = setTimeout(() => {
          if (!request.claimed)
            finish({
              ok: false,
              message: "No OpenCode pane in Zellij is showing this conversation, so nothing was done.",
            })
        }, CLAIM_TIMEOUT_MS)
        const resultTimer = setTimeout(
          () => finish({ ok: false, message: "The OpenCode pane did not report back in time." }),
          RESULT_TIMEOUT_MS,
        )
        signal.addEventListener("abort", cancel)
        void Promise.resolve(rpc.events.emit("request", { id, ...data })).catch((error) =>
          finish({ ok: false, message: `Could not reach the OpenCode panes: ${error}` }),
        )
      })

    // Paths are relative to the conversation's directory, which is this copy's.
    const showFile = (sessionID: string, paths: string[], signal: AbortSignal) =>
      ask(
        {
          sessionID,
          action: "show_file",
          paths: paths.map((path) => (isAbsolute(path) ? path : resolve(ctx.location.directory, path))),
        },
        signal,
      )

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "show_file",
        description:
          "Show files to the user: open them in the Helix editor of the Zellij tab where the user is talking " +
          "to you. Use this, not a shell command, whenever the user asks to see or open a file. It never " +
          "switches the user to another tab; it reports whether the files were opened.",
        input: {
          type: "object",
          properties: {
            paths: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              description: "Files to open, absolute or relative to this conversation's directory.",
            },
          },
          required: ["paths"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, context) => {
          const result = await showFile(context.sessionID, (input as { paths: string[] }).paths, context.signal)
          return { content: result.message }
        },
      })
    })
  },
})
