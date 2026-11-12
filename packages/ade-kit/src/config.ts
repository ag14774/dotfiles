// The ADE config: $XDG_CONFIG_HOME/ade/config.json (~/.config/ade/config.json).
// Optional, plain JSON (Node has no JSONC parser built in), read on every call
// so a change applies at once. It holds choices and options, never adapters.
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Config } from "./types.ts"

type Env = Record<string, string | undefined>

// Today's setup: Zellij with the dev layout and its pane names, Helix,
// OpenCode, and tuicr's comments filled in for you to send.
export const DEFAULTS: Config = {
  multiplexer: "zellij",
  editor: "helix",
  agent: "opencode",
  reviewer: "tuicr",
  review: { deliver: "insert" },
  zellij: {
    layout: "dev",
    panes: { agent: "opencode", shell: "main", editor: "editor", review: "review" },
    tabName: "{worktree}",
  },
}

export const configPath = (env: Env = process.env) => {
  const base = env.XDG_CONFIG_HOME?.startsWith("/") ? env.XDG_CONFIG_HOME : join(env.HOME || homedir(), ".config")
  return join(base, "ade", "config.json")
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Objects merge key by key; anything else replaces the default.
const merge = (base: unknown, over: unknown): unknown => {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(over)) merged[key] = merge(base[key], value)
  return merged
}

// The settings ade-kit itself reads must have the right type.
const check = (config: Config, path: string) => {
  const zellij: Record<string, unknown> = isObject(config.zellij) ? config.zellij : {}
  const panes: [string, unknown][] = isObject(zellij.panes) ? Object.entries(zellij.panes) : [["", undefined]]
  const values: Record<string, unknown> = {
    multiplexer: config.multiplexer,
    editor: config.editor,
    agent: config.agent,
    reviewer: config.reviewer,
    "zellij.layout": zellij.layout,
    "zellij.tabName": zellij.tabName,
    ...Object.fromEntries(panes.map(([role, name]) => [`zellij.panes${role ? `.${role}` : ""}`, name])),
  }
  const wrong = Object.keys(values).filter((key) => typeof values[key] !== "string")
  if (wrong.length) throw new Error(`ade: in ${path}, these must be strings: ${wrong.join(", ")}`)
  const deliver = isObject(config.review) ? config.review.deliver : undefined
  if (deliver !== "insert" && deliver !== "submit")
    throw new Error(`ade: in ${path}, review.deliver must be "insert" or "submit"`)
}

export function readConfig(env: Env = process.env): Config {
  const path = configPath(env)
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return structuredClone(DEFAULTS)
    throw new Error(`ade: cannot read ${path}: ${(error as Error).message}`)
  }
  let settings: unknown
  try {
    settings = JSON.parse(text)
  } catch (error) {
    throw new Error(`ade: ${path} is not valid JSON: ${(error as Error).message}`)
  }
  if (!isObject(settings)) throw new Error(`ade: ${path} must hold a JSON object`)
  const config = merge(structuredClone(DEFAULTS), settings) as Config
  check(config, path)
  return config
}
