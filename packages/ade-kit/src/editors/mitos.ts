// Mitos opens files as Helix does, by typing `:open` into its pane, and
// reloads files changed on disk by itself.
import type { Kit } from "../types.ts"

export default (kit: Kit) => {
  const { escape, enter, text } = kit.keys
  // As in Helix: %{...} is expanded inside double quotes, not single ones.
  const path = (path: string) => (path.includes("%") ? kit.quote.single(path) : kit.quote.double(path))
  return kit.typedEditor({
    name: "mitos",
    label: "Mitos",
    programs: ["ms"],
    open: (file) => [escape, text(`:open ${path(file.path)}`), enter],
    supports: { line: false, reload: "watches" },
  })
}
