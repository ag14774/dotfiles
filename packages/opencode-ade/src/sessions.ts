// The conversation a session belongs to: its top-level ancestor (a subagent
// acts for its parent). `parentOf` answers for one session; the chain is
// followed at most `depth` steps.
export async function rootOf(sessionID: string, parentOf: (id: string) => Promise<string | undefined>, depth = 16) {
  let id = sessionID
  for (let step = 0; step < depth; step++) {
    const parent = await parentOf(id)
    if (!parent) return id
    id = parent
  }
  return id
}
