// Server part of the status plugin (it runs in OpenCode's shared background
// service): the marks the OpenCode panes report, and the totals. The service
// has no multiplexer environment of its own (the ADE plugin removes Zellij's),
// so it acts in the session the reporting pane named.
import { Plugin } from "@opencode/plugin"
import { makeKit } from "../../ade-kit/src/kit.ts"
import { loadMultiplexer } from "../../ade-kit/src/load.ts"
import type { Mark } from "../../ade-kit/src/types.ts"
import { serverDigest } from "./digest.ts"
import type { Registry } from "./marks.ts"
import { countMarks, report } from "./marks.ts"
import { AdeStatus } from "./rpc.ts"

// The service loads one instance of this plugin per directory, and panes may
// talk to different ones, so the state is shared through the process.
const registry: Registry = ((globalThis as any).__adeStatusMarks ??= new Map())
// Totals are shown one at a time per session, so the last one reflects the
// latest tab names: session -> queue.
const totalsQueues: Map<string, Promise<unknown>> = ((globalThis as any).__adeStatusTotals ??= new Map())

// Taken once, when this module is evaluated: a running service keeps evaluated
// code, so this describes what runs even after the files change.
const RUNNING = serverDigest() ?? "unknown"

export default Plugin.define({
  id: "local.ade-status",
  async setup(ctx) {
    await ctx.rpc.register(AdeStatus, {
      info: async () => ({ digest: RUNNING }),
      tab_state: async (input) => {
        const { session, pane, mark } = input as { session: string; pane: string; mark: Mark }
        return { marks: report(registry, session, pane, mark) }
      },
      // Count the marks on the session's tabs and show the totals (with Zellij,
      // in every tab's zjstatus: its {pipe_agents} widget, see dev.kdl).
      totals: async (input) => {
        const where = input as { session: string; pane: string }
        const show = async () => {
          const adapter = await loadMultiplexer(makeKit())
          const mux = adapter?.connect(where)
          if (!mux?.marks || !mux.showTotals) return
          await mux.showTotals(countMarks((await mux.marks()).values()))
        }
        const queued = (totalsQueues.get(where.session) ?? Promise.resolve()).then(show)
        totalsQueues.set(where.session, queued.catch(() => {}))
        await queued
        return {}
      },
    })
  },
})
