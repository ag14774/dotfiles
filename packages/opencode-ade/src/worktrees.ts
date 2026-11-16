// What the status tool reports about each worktree.

// From `ade worktree ls --json`, plus the worktree's latest conversation.
export type Worktree = {
  path: string
  branch: string | null
  base: string
  changed: number
  ahead: number | null
  behind: number | null
  tab: "sure" | "unsure" | null
}
export type Conversation = { id: string; title?: string; state: string; last?: string }

// The parts of a conversation's record and last answer read here.
export type Record = { outcome?: string; time: { busy?: number; idle?: number } }
export type Answer = { error?: unknown; content?: { type: string; name?: string; text?: string; state?: { status?: string } }[] }

// What a conversation is doing: `waiting` when a permission request or
// question of it is pending.
export function stateOf(info: Record, last: Answer | undefined, waiting: boolean) {
  // A question asked before this plugin loaded shows only in the answer.
  const asking = last?.content?.some((part) => part.type === "tool" && part.name === "question" && part.state?.status === "running")
  const busy = info.time.busy !== undefined && (info.time.idle === undefined || info.time.busy > info.time.idle)
  if (waiting || asking) return "waiting for the user"
  if (busy) return "working"
  if (info.outcome === "failed" || last?.error) return "failed"
  if (info.outcome === "interrupted") return "interrupted"
  return "idle"
}

// The start of an answer's text, on one line.
export function excerpt(last: Answer | undefined, length = 160) {
  const text = (last?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

// One line per worktree; `directory` is the asking conversation's folder.
export function describe(worktree: Worktree & { conversation: Conversation | null }, directory: string) {
  const here = directory === worktree.path || directory.startsWith(`${worktree.path}/`)
  const parts = [
    worktree.branch ? `branch ${worktree.branch}` : "detached HEAD",
    worktree.changed ? `${worktree.changed} changed file${worktree.changed === 1 ? "" : "s"}` : "no changes",
  ]
  if (worktree.ahead !== null) parts.push(`${worktree.ahead} ahead, ${worktree.behind} behind ${worktree.base}`)
  parts.push(worktree.tab === "sure" ? "tab open" : worktree.tab === "unsure" ? "tab probably open" : "no tab")
  const conversation = worktree.conversation
  const talk = conversation ? `conversation ${conversation.state}${conversation.last ? `: "${conversation.last}"` : ""}` : "no conversation"
  return `- ${worktree.path}${here ? " (this conversation)" : ""}: ${parts.join(", ")}; ${talk}`
}
