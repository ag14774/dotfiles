// A fingerprint of the files the server part runs, below `packages/`. The
// server part takes it when its module is evaluated (the code it runs); the
// app part compares it with the files now.
import { createHash } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// The server part's own files: server.ts and what it imports from src/.
export const SERVER_FILES = ["server.ts", "rpc.ts", "digest.ts", "delegate.ts", "worktrees.ts"]

export function serverDigest(): string | undefined {
  try {
    // A running service that picks up the package loads it through the link
    // in plugins/, not from its real place.
    const packages = join(dirname(realpathSync(fileURLToPath(import.meta.url))), "../..")
    const hash = createHash("sha256")
    for (const file of SERVER_FILES) hash.update(readFileSync(join(packages, "opencode-ade", "src", file)))
    return hash.digest("hex").slice(0, 16)
  } catch {
    return undefined
  }
}
