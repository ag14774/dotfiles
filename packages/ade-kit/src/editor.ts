// The helper for editors without remote control (Helix, Mitos): files open by
// typing into the editor's pane, so they need a multiplexer.
import { accessSync, constants, statSync } from "node:fs"
import { join } from "node:path"
import type { Editor, Key, Reach, TypedEditorOptions } from "./types.ts"

// The first of `programs` on PATH, as an absolute path: a multiplexer may start
// it with another PATH than the caller's.
export function onPath(programs: readonly string[], path = process.env.PATH ?? ""): string | undefined {
  for (const program of programs)
    for (const dir of path.split(":")) {
      if (!dir) continue
      const file = join(dir, program)
      try {
        accessSync(file, constants.X_OK)
        if (statSync(file).isFile()) return file
      } catch {
        // not there
      }
    }
  return undefined
}

// "a", "a and b", "a, b and c"
export const listed = (items: readonly string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`

export function typedEditor(o: TypedEditorOptions): Editor {
  const label = o.label ?? o.name
  const typing = async (reach: Reach, keys: Key[]) => {
    if (!reach.mux || reach.pane === undefined) throw new Error(`${label} is reached through its pane, which needs a multiplexer`)
    await reach.mux.type(reach.pane, keys)
  }
  const reload = o.reload
  return {
    api: 1,
    name: o.name,
    label,
    programs: o.programs,
    supports: { ...o.supports, remote: false },
    start:
      o.start ??
      ((files) => {
        const program = onPath(o.programs)
        if (!program) throw new Error(`${label} executable not found (tried ${listed(o.programs)})`)
        return [program, ...files.map((file) => file.path)]
      }),
    open: (files, reach) => typing(reach, files.flatMap((file) => o.open(file))),
    ...(reload ? { reload: (reach: Reach) => typing(reach, reload()) } : {}),
  }
}
