// A fingerprint of the files the server part runs, below `packages/`. The
// server part takes it when its module is evaluated (the code it runs); the
// app part compares it with the files now.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

const files = ["opencode-ade/src/server.ts", "opencode-ade/src/rpc.ts", "opencode-ade/src/digest.ts"]

export function serverDigest(): string | undefined {
  try {
    const packages = new URL("../../", import.meta.url)
    const hash = createHash("sha256")
    for (const file of files) hash.update(readFileSync(new URL(file, packages)))
    return hash.digest("hex").slice(0, 16)
  } catch {
    return undefined
  }
}
