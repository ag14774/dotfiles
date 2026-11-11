// The app part in each OpenCode pane reports its mark and asks the server part
// (shared by all panes) for the marks of the other panes, and for the totals.
//
// A plain object: `Rpc.define` only returns its argument, and nothing else has
// to resolve. OpenCode 2.2.5 fails calls to methods without an output schema,
// and ignores a definition without `events`.

const object = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) =>
  ({ type: "object", properties, required, additionalProperties: false }) as const
const text = { type: "string" } as const
const empty = object({})
const mark = { type: "string", enum: ["none", "working", "waiting", "done", "failed"] } as const

export const AdeStatus = {
  id: "ade-status",
  methods: {
    // The fingerprint of the server code that is running (see digest.ts).
    info: { input: empty, output: object({ digest: text }) },
    // Report this pane's mark (pane in a multiplexer session); get the marks of
    // every pane in that session.
    tab_state: {
      input: object({ session: text, pane: text, mark }),
      output: object({ marks: { type: "object", additionalProperties: text } }),
    },
    // Count the marks on the session's tabs, and show the totals.
    totals: { input: object({ session: text, pane: text }), output: empty },
  },
  events: {},
} as const
