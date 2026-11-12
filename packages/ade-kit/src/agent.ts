// The helper for agents without a way to take text from outside (most agent
// CLIs): text is pasted into the agent's pane, so it needs a multiplexer.
import type { Agent, PasteAgentOptions, Reach } from "./types.ts"

export function pasteAgent(o: PasteAgentOptions): Agent {
  const label = o.label ?? o.name
  const pane = (reach: Reach) => {
    if (!reach.mux || reach.pane === undefined) throw new Error(`${label} is reached through its pane, which needs a multiplexer`)
    return { mux: reach.mux, pane: reach.pane }
  }
  return {
    api: 1,
    name: o.name,
    label,
    start: o.start,
    insert: async (text, reach) => {
      const { mux, pane: id } = pane(reach)
      await mux.paste(id, text)
    },
    // Pasted, then Enter.
    submit: async (text, reach) => {
      const { mux, pane: id } = pane(reach)
      await mux.paste(id, text)
      await mux.type(id, [{ key: "enter" }])
    },
  }
}
