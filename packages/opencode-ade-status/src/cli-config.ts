// Whether the OpenCode app's settings (cli.json) switch off one of its own
// plugins. Plugins can't ask the app, so this reads the settings as it does:
// $XDG_CONFIG_HOME/opencode/cli.json or ~/.config/opencode/cli.json, comments
// and trailing commas allowed, with OPENCODE_CLI_CONFIG_CONTENT merged over it
// (a list there replaces the file's). Its `plugins` entries apply in order: an
// ID or wildcard enables what it matches, the same with "-" disables it, and
// built-in plugins are on unless disabled (OpenCode 2.2.5 docs: cli/plugins).
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// JSON with // and /* */ comments and trailing commas, or undefined.
export function parseJsonc(text: string): unknown {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1
      out += text.slice(i, j + 1)
      i = j
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      out += "\n"
    } else if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2)
      i = close === -1 ? text.length : close + 1
      out += " "
    } else if (c === "," && /^\s*[}\]]/.test(text.slice(i + 1).replace(/^(\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, ""))) {
      // a trailing comma: dropped
    } else out += c
  }
  try {
    return JSON.parse(out)
  } catch {
    return undefined
  }
}

const matches = (pattern: string, id: string) => {
  const name = pattern.replace(/(?<=.)@[^@/]*$/, "") // without an @version
  const glob = new RegExp(`^${name.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
  return glob.test(id)
}

export function disables(plugins: unknown, id: string): boolean {
  if (!Array.isArray(plugins)) return false
  let off = false
  for (const entry of plugins) {
    const spec = typeof entry === "string" ? entry : (entry as { package?: unknown } | null)?.package
    if (typeof spec !== "string") continue
    if (spec.startsWith("-")) off = matches(spec.slice(1), id) || off
    else if (matches(spec, id)) off = false
  }
  return off
}

const record = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

// The `plugins` entries in effect, or undefined when there are none.
export function cliPlugins(env: NodeJS.ProcessEnv = process.env, home = homedir()): unknown {
  const inline = env.OPENCODE_CLI_CONFIG_CONTENT ? record(parseJsonc(env.OPENCODE_CLI_CONFIG_CONTENT)) : undefined
  if (inline && "plugins" in inline) return inline.plugins
  const dir = env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, "opencode") : join(home, ".config", "opencode")
  try {
    return record(parseJsonc(readFileSync(join(dir, "cli.json"), "utf8")))?.plugins
  } catch {
    return undefined
  }
}

export const switchedOff = (id: string, env: NodeJS.ProcessEnv = process.env, home = homedir()) =>
  disables(cliPlugins(env, home), id)
