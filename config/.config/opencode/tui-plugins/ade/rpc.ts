// The server part asks the OpenCode apps in Zellij panes to act for a
// conversation. The app showing it (or its parent, for a subagent) claims the
// request, runs the action's command with its own pane's environment, and
// reports back.
//
// A plain object: `Rpc.define` only returns its argument, and the OpenCode app
// cannot resolve `@opencode/plugin/rpc` for a plugin outside a package.
// OpenCode 2.2.5 fails calls to methods without an output schema, and ignores
// a definition without `events`.

const object = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) =>
  ({ type: "object", properties, required, additionalProperties: false }) as const
const text = { type: "string" } as const
const empty = object({})
const result = object({ ok: { type: "boolean" }, message: text })

export const Ade = {
  id: "ade",
  methods: {
    // The fingerprint of the server code that is running (see digest.ts).
    info: { input: empty, output: object({ digest: text }) },
    // What the show_file, delegate and status tools do, for scripts and tests.
    show_file: {
      input: object({ sessionID: text, paths: { type: "array", items: text, minItems: 1 } }),
      output: result,
    },
    delegate: {
      input: object(
        {
          sessionID: text,
          branch: text,
          brief: text,
          base: text,
          context: { type: "string", enum: ["none", "full", "compact"] },
        },
        ["sessionID", "branch", "brief"],
      ),
      output: result,
    },
    status: {
      input: object({ sessionID: text }),
      output: object(
        { ok: { type: "boolean" }, message: text, worktrees: { type: "array", items: { type: "object" } } },
        ["ok", "message", "worktrees"],
      ),
    },
    // Report what this pane shows in its tab's name; get every pane's state in
    // the same Zellij session.
    tab_state: {
      input: object({
        zellij: text,
        pane: text,
        state: { type: "string", enum: ["none", "working", "waiting", "done", "failed"] },
      }),
      output: object({ states: { type: "object", additionalProperties: text } }),
    },
    // An OpenCode pane in Zellij shows this conversation: attach the
    // environment instructions to it.
    attach: { input: object({ sessionID: text }), output: empty },
    claim: { input: object({ id: text }), output: object({ granted: { type: "boolean" } }) },
    finish: {
      input: object({ id: text, ok: { type: "boolean" }, stdout: text, stderr: text }),
      output: empty,
    },
  },
  events: {
    request: {
      schema: object(
        {
          id: text,
          sessionID: text,
          action: { type: "string", enum: ["show_file", "delegate", "status"] },
          args: { type: "array", items: text },
          cwd: text,
          timeout: { type: "number" },
          // delegate with context: first copy this conversation into the
          // worktree `prepare` creates; the command then runs on the copy.
          copy: object(
            { sessionID: text, before: text, compact: { type: "boolean" }, prepare: { type: "array", items: text } },
            ["sessionID", "compact", "prepare"],
          ),
        },
        ["id", "sessionID", "action", "args", "cwd", "timeout"],
      ),
    },
  },
} as const
