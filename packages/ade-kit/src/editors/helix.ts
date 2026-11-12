// Helix has no remote control: files open by typing `:open` into its pane.
// It doesn't reload files changed on disk (`:reload-all`, Ctrl-R in the
// dotfiles, discards unsaved edits, so that is left to you).
import type { Kit } from "../types.ts"

export default (kit: Kit) => {
  const { escape, enter, text } = kit.keys
  // Helix expands %{...} inside double quotes, not inside single quotes.
  const path = (path: string) => (path.includes("%") ? kit.quote.single(path) : kit.quote.double(path))
  return kit.typedEditor({
    name: "helix",
    label: "Helix",
    programs: ["hx", "helix"],
    open: (file) => [escape, text(`:open ${path(file.path)}`), enter],
    supports: { line: false, reload: "none" },
  })
}
