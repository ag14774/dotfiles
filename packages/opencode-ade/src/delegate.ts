// What the delegate tool asks the pane to run, and what it tells the agent.

export type Task = {
  branch: string
  brief: string
  base?: string
  context?: "none" | "full" | "compact"
  directory?: string
}
// Copy conversation sessionID (up to message `before`) into the worktree that
// `prepare` creates, and run the request's command on the copy.
export type Copy = { sessionID: string; before?: string; compact: boolean; prepare: string[] }

// The worktree command for `task` (and the copy of the conversation, with
// "context"), or why nothing can be delegated. `before`: the request to
// delegate, which the copy stops at.
export function delegation(
  sessionID: string,
  task: Task,
  before?: string,
): { error: string } | { args: string[]; copy?: Copy } {
  const names = [task.branch, task.base ?? ""]
  if (!task.branch.trim() || names.some((name) => name.startsWith("-") || /\s/.test(name)))
    return { error: "Nothing was delegated: branch and base must be names without spaces." }
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
  return { args: ["open", "--prompt", brief, task.branch, ...base], ...(copy ? { copy } : {}) }
}

// What the agent is told once the tab is open on `worktree`.
export const delegated = (task: Task, worktree: string, copy?: Copy) =>
  `Opened a background tab for ${task.branch} (worktree ${worktree}); its OpenCode is ` +
  (copy
    ? `working on the brief in a ${copy.compact ? "compacted " : ""}copy of this conversation. `
    : "working on the brief. ") +
  "You are not told when it finishes; the user follows it in that tab."
