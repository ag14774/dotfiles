// When the work in an OpenCode pane ends, and how: kept apart from OpenCode
// for tests.
//
// OpenCode (2.2.5, packages/tui/src/context/program-status.ts) reports one
// root record for its pane: "blocked" when one of its conversations waits for
// you, else "working" when one works, else "idle". Its conversations are the
// one it shows and its session tabs. It never reports how work ended
// (OpenCode issue #60411), so this package adds "done" or "error" to that root
// record when the root goes idle.

export type Activity = "blocked" | "working" | "idle"
// `settled`: the conversation's record has caught up with its last turn (OpenCode's
// app learns that a conversation went idle before its new outcome arrives).
export type Conversation = { activity: Activity; settled: boolean; outcome?: string; title?: string }
export type Ending = { state: "done" | "error"; title?: string }

// OpenCode's root record for these conversations.
export const rootOf = (activities: readonly Activity[]): Activity =>
  activities.includes("blocked") ? "blocked" : activities.includes("working") ? "working" : "idle"

// Follows the pane's conversations (`ids`, in OpenCode's terms above) and
// returns how their work ended when the root goes idle: "error" if one of
// those at work since the root was last idle failed or was interrupted, else
// "done", once their outcomes are in. Nothing when one only left the pane
// (another conversation shown, a tab closed) while still at work.
export function follower(state: (id: string) => Conversation) {
  let busy: string[] = [] // the conversations at work since the root was last idle
  return (ids: readonly string[]): Ending | undefined => {
    const now = ids.filter((id) => state(id).activity !== "idle")
    if (now.length) {
      busy = [...new Set([...busy, ...now])]
      return undefined
    }
    const ended = busy
    if (ended.some((id) => state(id).activity === "idle" && !state(id).settled)) return undefined
    busy = []
    if (!ended.length || ended.some((id) => state(id).activity !== "idle")) return undefined
    const failed = ended.some((id) => ["failed", "interrupted"].includes(state(id).outcome ?? ""))
    const title = ended.length === 1 ? clip(state(ended[0]).title, 192) : undefined
    return { state: failed ? "error" : "done", ...(title ? { title } : {}) }
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// OSC 7501 fields take one line without control characters, within a byte
// limit (as OpenCode clips its own).
export function clip(text: string | undefined, bytes: number) {
  const line = (text ?? "")
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!line) return undefined
  const encoded = encoder.encode(line)
  if (encoded.byteLength <= bytes) return line
  return decoder.decode(encoded.subarray(0, bytes - 3)).replace(/\uFFFD+$/, "") + "…"
}
