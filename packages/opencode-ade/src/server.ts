// Server part of the ADE plugin (it runs in OpenCode's shared background service).
//
// Agent commands run in this service, not in a pane. A conversation shown in an
// OpenCode pane gets that pane's environment, but one no pane shows falls back to
// the service's own, copied from whichever pane happened to start the service.
// So the Zellij variables are removed from it, and anything that must act in
// "the user's tab" is done by the OpenCode app in the pane showing the
// conversation (tui.ts), which knows its own pane for certain. (The agent
// statuses on the tabs come from the status plugin, packages/opencode-ade-status.)
import { randomUUID } from "node:crypto"
import { statSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"
import { Plugin } from "@opencode/plugin"
import { serverDigest } from "./digest.ts"
import { Ade } from "./rpc.ts"

type Action = "show_file" | "delegate" | "status"
// Copy conversation sessionID (up to message `before`) into the worktree that
// `prepare` creates, and run the request's command on the copy (delegate).
type Copy = { sessionID: string; before?: string; compact: boolean; prepare: string[] }
type Task = { branch: string; brief: string; base?: string; context?: "none" | "full" | "compact"; directory?: string }
// From `ade worktree ls --json`, plus the worktree's latest conversation.
type Worktree = {
  path: string
  branch: string | null
  changed: number
  ahead: number | null
  behind: number | null
  tab: "sure" | "unsure" | null
}
type Conversation = { id: string; title?: string; state: string; last?: string }
// ran: the pane ran the command (otherwise `message` says why not).
type Result = { ok: boolean; ran: boolean; stdout: string; message: string }
type Pending = { claimed: boolean; finish: (result: Result) => void }

// The service loads one instance of this plugin per directory, and a pane's app
// may talk to another instance than the conversation's (after /cd, for example).
// Pending requests are therefore shared through the process.
const pending: Map<string, Pending> = ((globalThis as any).__adePending ??= new Map())

// Conversations waiting for the user: session ID -> pending permission
// requests and questions (forms), from events. Each copy sees its folder's.
const waiting: Map<string, Set<string>> = ((globalThis as any).__adeWaiting ??= new Map())
const WAITING_EVENTS = ["permission.asked", "permission.replied", "form.created", "form.replied", "form.cancelled"]

// Taken once, when this module is evaluated: a running service keeps evaluated
// code, so this describes what runs even after the files change.
const RUNNING = serverDigest() ?? "unknown"

const CLAIM_TIMEOUT_MS = 5_000
const TIMEOUT_MS: Record<Action, number> = { show_file: 15_000, delegate: 120_000, status: 30_000 }
const COMPACT_TIMEOUT_MS = 300_000

// The environment instructions, which the app part builds from the ADE config.
const ENVIRONMENT_KEY = "ade.environment"

// delegate's and status's `directory`.
const DIRECTORY = "A folder in the repository to work in; default: this conversation's folder."

export default Plugin.define({
  id: "local.ade",
  async setup(ctx) {
    for (const name of ["ZELLIJ", "ZELLIJ_SESSION_NAME", "ZELLIJ_PANE_ID"]) delete process.env[name]

    const events = new AbortController()
    const track = (sessionID: string, id: string, asked: boolean) => {
      const ids = waiting.get(sessionID) ?? new Set<string>()
      asked ? ids.add(id) : ids.delete(id)
      ids.size ? waiting.set(sessionID, ids) : waiting.delete(sessionID)
    }
    void (async () => {
      for await (const event of ctx.event.subscribe({ types: WAITING_EVENTS as any, signal: events.signal })) {
        const data = (event as any).data
        if (event.type === "permission.asked") track(data.sessionID, data.id, true)
        else if (event.type === "permission.replied") track(data.sessionID, data.requestID, false)
        else if (event.type === "form.created") track(data.form.sessionID, data.form.id, true)
        else if (event.type === "form.replied" || event.type === "form.cancelled") track(data.sessionID, data.id, false)
      }
    })().catch(() => {})

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
      status: async (input, context) => {
        const { sessionID, directory } = input as { sessionID: string; directory?: string }
        return status(sessionID, context.signal, directory)
      },
      attach: async (input) => {
        const { sessionID, instructions } = input as { sessionID: string; instructions: string }
        const entries = await ctx.session.instructions.entry.list({ sessionID })
        if (!entries.some((entry) => entry.key === ENVIRONMENT_KEY && entry.value === instructions))
          await ctx.session.instructions.entry.put({ sessionID, key: ENVIRONMENT_KEY, value: instructions })
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
    const ask = (sessionID: string, action: Action, args: string[], cwd: string, signal: AbortSignal, copy?: Copy) =>
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
        const timeout = TIMEOUT_MS[action] + (copy?.compact ? COMPACT_TIMEOUT_MS : 0)
        const resultTimer = setTimeout(
          () => refuse("The OpenCode pane did not report back in time."),
          timeout + CLAIM_TIMEOUT_MS,
        )
        signal.addEventListener("abort", cancel)
        const data = { id, sessionID, action, args, cwd, timeout, ...(copy ? { copy } : {}) }
        void Promise.resolve(rpc.events.emit("request", data)).catch((error) =>
          refuse(`Could not reach the OpenCode panes: ${error}`),
        )
      })

    // Paths are relative to the conversation's directory, which is this copy's.
    const showFile = async (sessionID: string, paths: string[], signal: AbortSignal) => {
      const absolute = paths.map((path) => (isAbsolute(path) ? path : resolve(ctx.location.directory, path)))
      const result = await ask(sessionID, "show_file", absolute, ctx.location.directory, signal)
      if (result.ok) return { ok: true, message: `Opened ${absolute.join(", ")} in the user's editor.` }
      return { ok: false, message: result.message || "The editor could not open the files." }
    }

    // The folder delegate and status work in: `directory` (relative to the
    // conversation's folder, or to your home with ~/), else the conversation's
    // folder.
    const folderFor = (directory?: string) => {
      const folder = directory
        ? resolve(ctx.location.directory, directory.replace(/^~(?=\/|$)/, homedir()))
        : ctx.location.directory
      return statSync(folder, { throwIfNoEntry: false })?.isDirectory() ? folder : undefined
    }

    // `before`: copy the conversation up to this message (the request to delegate).
    const delegate = async (sessionID: string, task: Task, signal: AbortSignal, before?: string) => {
      const names = [task.branch, task.base ?? ""]
      if (!task.branch.trim() || names.some((name) => name.startsWith("-") || /\s/.test(name)))
        return { ok: false, message: "Nothing was delegated: branch and base must be names without spaces." }
      const cwd = folderFor(task.directory)
      if (!cwd) return { ok: false, message: `Nothing was delegated: ${task.directory} is not a folder.` }
      const base = task.base ? [task.base] : []
      const mode = task.context ?? "none"
      const copy =
        mode === "none"
          ? undefined
          : {
              sessionID,
              ...(before ? { before } : {}),
              compact: mode === "compact",
              prepare: ["open", "--stay", task.branch, ...base],
            }
      const brief = copy
        ? `This conversation was copied into the worktree for branch ${task.branch}, which is now its ` +
          "folder, to work on the task below. The original conversation goes on in its own tab; work only " +
          `here, and don't delegate this again.\n\n${task.brief}`
        : task.brief
      const result = await ask(sessionID, "delegate", ["open", "--prompt", brief, task.branch, ...base], cwd, signal, copy)
      if (result.ok)
        return {
          ok: true,
          message:
            `Opened a background tab for ${task.branch} (worktree ${result.stdout.trim()}); its OpenCode is ` +
            (copy ? `working on the brief in a ${copy.compact ? "compacted " : ""}copy of this conversation. ` : "working on the brief. ") +
            "You are not told when it finishes; the user follows it in that tab.",
        }
      if (!result.ran) return { ok: false, message: result.message }
      return { ok: false, message: `Nothing was delegated: ${result.message || "the worktree command failed."}` }
    }

    // The latest top-level conversation in `directory`: what it is doing, and
    // the start of its last answer.
    const conversationIn = async (directory: string): Promise<Conversation | null> => {
      const page = (await ctx.session.list({ directory, parentID: null, limit: 1, order: "desc" })) as any
      const info = (page?.data ?? page)?.[0]
      if (!info) return null
      const messages = (await ctx.session.context({ sessionID: info.id })) as any[]
      const last = messages.findLast((message) => message.type === "assistant")
      const pending = waiting.has(info.id)
      // A question asked before this plugin copy loaded.
      const asking = last?.content?.some(
        (part: any) => part.type === "tool" && part.name === "question" && part.state?.status === "running",
      )
      const busy = info.time.busy !== undefined && (info.time.idle === undefined || info.time.busy > info.time.idle)
      const state =
        pending || asking
          ? "waiting for the user"
          : busy
            ? "working"
            : info.outcome === "failed" || last?.error
              ? "failed"
              : info.outcome === "interrupted"
                ? "interrupted"
                : "idle"
      const text = (last?.content ?? [])
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
      const excerpt = text.length > 160 ? `${text.slice(0, 159)}…` : text
      return { id: info.id, ...(info.title ? { title: info.title } : {}), state, ...(excerpt ? { last: excerpt } : {}) }
    }

    const describe = (worktree: Worktree & { conversation: Conversation | null }) => {
      const here = ctx.location.directory === worktree.path || ctx.location.directory.startsWith(`${worktree.path}/`)
      const parts = [
        worktree.branch ? `branch ${worktree.branch}` : "detached HEAD",
        worktree.changed ? `${worktree.changed} changed file${worktree.changed === 1 ? "" : "s"}` : "no changes",
      ]
      if (worktree.ahead !== null) parts.push(`${worktree.ahead} ahead, ${worktree.behind} behind origin/HEAD`)
      parts.push(worktree.tab === "sure" ? "tab open" : worktree.tab === "unsure" ? "tab probably open" : "no tab")
      const conversation = worktree.conversation
      const talk = conversation
        ? `conversation ${conversation.state}${conversation.last ? `: "${conversation.last}"` : ""}`
        : "no conversation"
      return `- ${worktree.path}${here ? " (this conversation)" : ""}: ${parts.join(", ")}; ${talk}`
    }

    const status = async (sessionID: string, signal: AbortSignal, directory?: string) => {
      const cwd = folderFor(directory)
      if (!cwd) return { ok: false, message: `${directory} is not a folder.`, worktrees: [] }
      const result = await ask(sessionID, "status", ["ls", "--json"], cwd, signal)
      if (!result.ran) return { ok: false, message: result.message, worktrees: [] }
      if (!result.ok) return { ok: false, message: `Could not list the worktrees: ${result.message}`, worktrees: [] }
      const worktrees = await Promise.all(
        (JSON.parse(result.stdout) as Worktree[]).map(async (worktree) => ({
          ...worktree,
          conversation: await conversationIn(worktree.path).catch(() => null),
        })),
      )
      return { ok: true, message: [`Worktrees (${worktrees.length}):`, ...worktrees.map(describe)].join("\n"), worktrees }
    }

    await ctx.tool.transform((editor) => {
      // Agents make worktrees with delegate, which also opens their tab
      // (OpenCode's own make them without one; through
      // packages/opencode-ade-worktrees, where wt would).
      editor.remove("opencode_worktree_create")
      editor.remove("opencode_worktree_list")
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
          "to check the result. Set `context` when the user wants the new conversation to keep this one's " +
          "history (\"with the context\": full; \"with a summary\": compact). It returns once the tab is open " +
          "and does not wait for the work. It works in the repository of this conversation's folder; for " +
          "another repository, set `directory` to a folder in it.",
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
            context: {
              type: "string",
              enum: ["none", "full", "compact"],
              description:
                "none (default): a new conversation starts on the brief. full: a copy of this conversation " +
                "continues there. compact: like full, but the copy is compacted (summarized) first.",
            },
            directory: { type: "string", description: DIRECTORY },
          },
          required: ["branch", "brief"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, context) => {
          const task = input as Task
          let before: string | undefined
          if (task.context && task.context !== "none") {
            const messages = await ctx.session.context({ sessionID: context.sessionID })
            before = messages.filter((message) => message.type === "user").at(-1)?.id
          }
          const result = await delegate(context.sessionID, task, context.signal, before)
          return { content: result.message }
        },
      })
      editor.add({
        name: "status",
        description:
          "Show how this project's worktrees are doing: for each, its branch, uncommitted changes, commits " +
          "ahead of the default branch, whether it has a Zellij tab, and its latest OpenCode conversation " +
          "(working, waiting for the user, idle, failed) with the start of its last answer. Read-only. Use it " +
          "when the user asks about other worktrees, tabs or delegated tasks. For another repository's " +
          "worktrees, set `directory` to a folder in it.",
        input: {
          type: "object",
          properties: { directory: { type: "string", description: DIRECTORY } },
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, context) => {
          const { directory } = input as { directory?: string }
          return { content: (await status(context.sessionID, context.signal, directory)).message }
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

    return () => events.abort()
  },
})
