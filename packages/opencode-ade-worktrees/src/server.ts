// OpenCode's worktree strategy through ade-kit (strategy.ts): what OpenCode
// itself makes or removes (the TUI's Open → a project → Worktrees → Ctrl+N,
// the desktop app, the agents' worktree_remove, its API) follows the
// repository's layout, gets a real branch and seeded files, and is removed
// with wtrm's checks. Agents still make worktrees with the ADE plugin's
// delegate, which also opens a tab.
import { Plugin, Worktree } from "@opencode/plugin"
import { strategy } from "./strategy.ts"

export default Plugin.define({
  id: "local.ade-worktrees",
  async setup(ctx) {
    await ctx.worktree.transform((editor) => {
      editor.add(
        strategy({
          env: process.env,
          projectID: ctx.location.project.id,
          forceRequired: (message) => new Worktree.OperationError({ message, forceRequired: true }),
        }),
      )
    })
  },
})
