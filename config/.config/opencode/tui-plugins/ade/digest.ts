// A fingerprint of the ADE plugin's server code: these files, below the
// OpenCode config directory `config`. The server part takes it when its module
// is evaluated (the code it runs); the app part compares it with the files now.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

const files = ["plugins/ade.ts", "tui-plugins/ade/rpc.ts", "tui-plugins/ade/digest.ts", "tui-plugins/ade/tabs.ts"]

export function serverDigest(config: URL): string | undefined {
  try {
    const hash = createHash("sha256")
    for (const file of files) hash.update(readFileSync(new URL(file, config)))
    return hash.digest("hex").slice(0, 16)
  } catch {
    return undefined
  }
}
