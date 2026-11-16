import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { SERVER_FILES, serverDigest } from "../src/digest.ts"

// The files server.ts loads from src/, following their imports.
const loaded = (file: string, seen = new Set<string>()) => {
  if (seen.has(file)) return seen
  seen.add(file)
  const text = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")
  for (const [, next] of text.matchAll(/from "\.\/([\w-]+\.ts)"/g)) loaded(next, seen)
  return seen
}

test("the server's fingerprint covers every file the server part loads", () => {
  assert.deepEqual([...loaded("server.ts")].sort(), [...SERVER_FILES].sort())
  assert.match(serverDigest() ?? "", /^[0-9a-f]{16}$/)
})
