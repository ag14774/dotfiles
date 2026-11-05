const requestID = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
  additionalProperties: false,
} as const

// The server part asks the OpenCode apps in Zellij panes to act for a
// conversation. The app showing it (or its parent, for a subagent) claims the
// request, does the work with its own pane's environment, and reports back.
//
// A plain object: `Rpc.define` only returns its argument, and the OpenCode app
// cannot resolve `@opencode/plugin/rpc` for a plugin outside a package.
const empty = { type: "object", properties: {}, additionalProperties: false } as const
const result = {
  type: "object",
  properties: { ok: { type: "boolean" }, message: { type: "string" } },
  required: ["ok", "message"],
  additionalProperties: false,
} as const

export const Ade = {
  id: "ade",
  methods: {
    // The fingerprint of the server code that is running (see digest.ts).
    info: {
      input: empty,
      output: {
        type: "object",
        properties: { digest: { type: "string" } },
        required: ["digest"],
        additionalProperties: false,
      },
    },
    // What the show_file tool does, for scripts and tests.
    show_file: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" }, paths: { type: "array", items: { type: "string" }, minItems: 1 } },
        required: ["sessionID", "paths"],
        additionalProperties: false,
      },
      output: result,
    },
    claim: {
      input: requestID,
      output: {
        type: "object",
        properties: { granted: { type: "boolean" } },
        required: ["granted"],
        additionalProperties: false,
      },
    },
    finish: {
      input: {
        type: "object",
        properties: { id: { type: "string" }, ok: { type: "boolean" }, message: { type: "string" } },
        required: ["id", "ok", "message"],
        additionalProperties: false,
      },
      // OpenCode 2.2.5 fails a call whose method has no output schema.
      output: empty,
    },
  },
  events: {
    request: {
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          sessionID: { type: "string" },
          action: { type: "string", enum: ["show_file"] },
          paths: { type: "array", items: { type: "string" } },
        },
        required: ["id", "sessionID", "action", "paths"],
        additionalProperties: false,
      },
    },
  },
} as const
