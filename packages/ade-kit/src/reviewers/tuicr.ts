// tuicr (tuicr.dev): `c` comments, `e` opens the file in $EDITOR, `y` ends
// the review and prints the comments (with --stdout), `:q` prints nothing.
// Its theme and other settings live in its own config.
import type { Reviewer } from "../types.ts"

export default (): Reviewer => ({
  api: 1,
  name: "tuicr",
  command: (scope) => [
    "tuicr",
    ...(scope.commits ? ["-r", `${scope.base}..HEAD`] : []),
    ...(scope.uncommitted ? ["-w"] : []),
    "--stdout",
  ],
  editorVariable: "EDITOR",
})
