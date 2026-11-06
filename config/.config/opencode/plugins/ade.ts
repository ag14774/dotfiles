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

type Action = "show_file" | "delegate"
// ran: the pane ran the command (otherwise `message` says why not).
type Result = { ok: boolean; ran: boolean; stdout: string; message: string }
type Pending = { claimed: boolean; finish: (result: Result) => void }

// The service loads one instance of this plugin per directory, and a pane's app
// may talk to another instance than the conversation's (after /cd, for example).
// Pending requests are therefore shared through the process.
const pending: Map<string, Pending> = ((globalThis as any).__adePending ??= new Map())

// Taken once, when this module is evaluated: a running service keeps evaluated
// code, so this describes what runs even after the files change.
const RUNNING = serverDigest(new URL("../", import.meta.url)) ?? "unknown"

const CLAIM_TIMEOUT_MS = 5_000
const TIMEOUT_MS: Record<Action, number> = { show_file: 15_000, delegate: 120_000 }

// Attached to each conversation an OpenCode pane in Zellij shows (see attach).
const ENVIRONMENT_KEY = "ade.environment"
const ENVIRONMENT = [
  "This conversation is shown in OpenCode inside a Zellij terminal tab. Each tab belongs to one git worktree of",
  "the project, managed with the user's `wt` command, and also has a shell pane and a Helix editor pane.",
  "- To show the user a file, use the show_file tool.",
  "- Work in another worktree only when the user asks (for example \"delegate this\" or \"do this in a new",
  "  worktree\"), with the delegate tool. Don't create worktrees, tabs or panes yourself (with git, wt, zellij",
  "  or OpenCode's worktree tools).",
].join("\n")

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
      delegate: async (input, context) => {
        const { sessionID, ...task } = input as { sessionID: string } & Task
        return delegate(sessionID, task, context.signal)
      },
      attach: async (input) => {
        const { sessionID } = input as { sessionID: string }
        const entries = await ctx.session.instructions.entry.list({ sessionID })
        if (!entries.some((entry) => entry.key === ENVIRONMENT_KEY && entry.value === ENVIRONMENT))
          await ctx.session.instructions.entry.put({ sessionID, key: ENVIRONMENT_KEY, value: ENVIRONMENT })
        return {}
      },
      claim: async (input) => {
        const request = pending.get((input as { id: string }).id)
        if (!request || request.claimed) return { granted: false }
        request.claimed = true
        return { granted: true }
      },
      finish: async (input) => {
        const { id, ok, stdout, stderr } = input as { id: string; ok: boolean; stdout: string; stderr: string }
        pending.get(id)?.finish({ ok, ran: true, stdout, message: stderr.trim() })
        return {}
      },
    })

    // Ask the pane showing the conversation to run `action` with `args` in `cwd`,
    // and wait for its answer.
    const ask = (sessionID: string, action: Action, args: string[], signal: AbortSignal) =>
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
        const refuse = (message: string) => finish({ ok: false, ran: false, stdout: "", message })
        const cancel = () => refuse("Cancelled.")
        request.finish = finish
        pending.set(id, request)
        const claimTimer = setTimeout(() => {
          if (!request.claimed) refuse("No OpenCode pane in Zellij is showing this conversation, so nothing was done.")
        }, CLAIM_TIMEOUT_MS)
        const resultTimer = setTimeout(
          () => refuse("The OpenCode pane did not report back in time."),
          TIMEOUT_MS[action] + CLAIM_TIMEOUT_MS,
        )
        signal.addEventListener("abort", cancel)
        const data = { id, sessionID, action, args, cwd: ctx.location.directory, timeout: TIMEOUT_MS[action] }
        void Promise.resolve(rpc.events.emit("request", data)).catch((error) =>
          refuse(`Could not reach the OpenCode panes: ${error}`),
        )
      })

    // Paths are relative to the conversation's directory, which is this copy's.
    const showFile = async (sessionID: string, paths: string[], signal: AbortSignal) => {
      const absolute = paths.map((path) => (isAbsolute(path) ? path : resolve(ctx.location.directory, path)))
      const result = await ask(sessionID, "show_file", absolute, signal)
      if (result.ok) return { ok: true, message: `Opened ${absolute.join(", ")} in the user's editor.` }
      return { ok: false, message: result.message || "The editor could not open the files." }
    }

    type Task = { branch: string; brief: string; base?: string }
    const delegate = async (sessionID: string, task: Task, signal: AbortSignal) => {
      const names = [task.branch, task.base ?? ""]
      if (!task.branch.trim() || names.some((name) => name.startsWith("-") || /\s/.test(name)))
        return { ok: false, message: "Nothing was delegated: branch and base must be names without spaces." }
      const args = ["open", "--prompt", task.brief, task.branch, ...(task.base ? [task.base] : [])]
      const result = await ask(sessionID, "delegate", args, signal)
      if (result.ok)
        return {
          ok: true,
          message:
            `Opened a background tab for ${task.branch} (worktree ${result.stdout.trim()}); its OpenCode is ` +
            "working on the brief. You are not told when it finishes; the user follows it in that tab.",
        }
      if (!result.ran) return { ok: false, message: result.message }
      return { ok: false, message: `Nothing was delegated: ${result.message || "wt-core failed."}` }
    }

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
      editor.add({
        name: "delegate",
        description:
          "Start work in another git worktree, in a new Zellij tab: creates (or reuses) the worktree for " +
          "`branch` and opens it in a background tab, where a new OpenCode conversation starts on `brief`. Use " +
          "it when the user asks to delegate something, to work on it in parallel, or to do it in a new worktree " +
          "or tab; never on your own initiative. The new conversation sees nothing of this one, so write a " +
          "complete brief: the goal, what you already know (files, findings, decisions), constraints, and how " +
          "to check the result. It returns once the tab is open and does not wait for the work.",
        input: {
          type: "object",
          properties: {
            branch: {
              type: "string",
              description: "The worktree's branch: an existing branch, or a new short name such as fix-login-timeout.",
            },
            brief: { type: "string", minLength: 1, description: "The complete task for the new conversation." },
            base: {
              type: "string",
              description: "Where a new branch starts (a branch or commit). Default: the remote's default branch.",
            },
          },
          required: ["branch", "brief"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, context) => {
          const result = await delegate(context.sessionID, input as Task, context.signal)
          return { content: result.message }
        },
      })
    })

    await ctx.command.transform((editor) => {
      editor.add({
        name: "delegate",
        description: "Hand a task to a new worktree tab (what to delegate, or nothing for the current task)",
        execute: async ({ sessionID, prompt, delivery }) => {
          const task = prompt.text?.trim()
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            delivery,
            text: task
              ? `Delegate this with the delegate tool: ${task}`
              : "Delegate the task we have been discussing with the delegate tool.",
          })
        },
      })
    })
  },
})
