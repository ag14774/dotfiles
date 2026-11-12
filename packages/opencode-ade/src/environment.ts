// The instructions an OpenCode pane attaches to each conversation it shows
// (entry ade.environment), naming the multiplexer and editor of the ADE
// config.
import { labelOf, loadEditor, loadMultiplexer } from "../../ade-kit/src/load.ts"
import type { Kit } from "../../ade-kit/src/types.ts"

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a")

// multiplexer: its name in prose and its command; editor: its name in prose.
export const environment = (o: { multiplexer: string; command: string; editor: string }) =>
  [
    `This conversation is shown in OpenCode inside ${article(o.multiplexer)} ${o.multiplexer} terminal tab. Each tab belongs to one git worktree of`,
    `the project, managed with the user's \`wt\` command, and also has a shell pane and ${article(o.editor)} ${o.editor} editor pane.`,
    "- To show the user a file, use the show_file tool. To see how the project's worktrees and their",
    "  conversations are doing, use the status tool.",
    '- Work in another worktree only when the user asks (for example "delegate this" or "do this in a new',
    `  worktree"), with the delegate tool. Don't create worktrees, tabs or panes yourself (with git, wt, ${o.command}`,
    "  or OpenCode's worktree tools).",
    "- delegate and status work on the repository of this conversation's folder. For another repository, give",
    "  them a folder in it as `directory`; there is no need to move this conversation first.",
  ].join("\n")

// The instructions for the configured multiplexer and editor.
export async function environmentFor(kit: Kit) {
  const [multiplexer, editor] = await Promise.all([loadMultiplexer(kit), loadEditor(kit)])
  if (!multiplexer) return undefined
  return environment({ multiplexer: labelOf(multiplexer), command: multiplexer.name, editor: labelOf(editor) })
}
