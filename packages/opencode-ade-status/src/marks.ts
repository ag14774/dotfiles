// The server part's bookkeeping, kept apart from OpenCode for tests.
import type { Mark, ShownMark } from "../../ade-kit/src/types.ts"

// What each OpenCode pane shows on its tab: multiplexer session -> pane -> mark.
export type Registry = Map<string, Map<string, Mark>>

// Record a pane's mark; the marks of every pane in its session.
export function report(registry: Registry, session: string, pane: string, mark: Mark) {
  const panes = registry.get(session) ?? new Map<string, Mark>()
  mark === "none" ? panes.delete(pane) : panes.set(pane, mark)
  panes.size ? registry.set(session, panes) : registry.delete(session)
  return Object.fromEntries(panes) as Record<string, Mark>
}

export function countMarks(marks: Iterable<Mark>): Record<ShownMark, number> {
  const counts = { waiting: 0, failed: 0, done: 0, working: 0 }
  for (const mark of marks) if (mark !== "none") counts[mark]++
  return counts
}
