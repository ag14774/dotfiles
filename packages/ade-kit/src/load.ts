// A choice from the config -> an adapter, checked. A built-in name takes the
// built-in (builtins.ts); a path (starting with "/", "./", "../", "~/" or
// "file:") loads that file, relative paths from the config's folder, and its
// default export is the function. The function gets the kit and returns the
// adapter.
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { builtins } from "./builtins.ts"
import type { Kind } from "./builtins.ts"
import { configPath } from "./config.ts"
import type { Agent, Editor, Kit, Layout, Multiplexer, MultiplexerAdapter, Reviewer } from "./types.ts"

export const API = 1

// Per kind: the operations an adapter needs, and the other fields it needs,
// with their types.
const KINDS: Record<Kind, { required: string[]; fields?: Record<string, "array" | "object"> }> = {
  multiplexer: { required: ["here", "connect"] },
  editor: { required: ["start", "open"], fields: { programs: "array", supports: "object" } },
  agent: { required: ["start", "insert", "submit"] },
  reviewer: { required: ["command"] },
  layout: { required: ["path"] },
}
// What a connected multiplexer must do (the rest is optional).
const MULTIPLEXER_REQUIRED = ["panes", "tabs", "start", "type", "paste", "focus"]

export type LoadOptions = { base?: string } // the folder relative paths start from

const isPath = (value: string) => /^(\/|\.\.?\/|~\/|file:)/.test(value)

// The function that makes the adapter: the built-in's, or the default export
// of the module at the path.
async function factoryOf(kind: Kind, value: string, base: string, what: string): Promise<unknown> {
  if (!isPath(value)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error(`ade: "${value}" is neither a built-in ${kind} nor a path`)
    const adapters: Record<string, unknown> = builtins(kind)
    if (!Object.hasOwn(adapters, value)) throw new Error(`ade: there is no built-in ${kind} named "${value}"`)
    return adapters[value]
  }
  const file = value.startsWith("~/") ? join(homedir(), value.slice(2)) : resolve(base, value)
  const url = value.startsWith("file:") ? value : pathToFileURL(file).href
  let module: { default?: unknown }
  try {
    module = await import(url)
  } catch (error) {
    throw new Error(`ade: cannot load ${what}: ${(error as Error).message}`)
  }
  return module.default
}

const missing = (object: Record<string, unknown>, operations: string[]) =>
  operations.filter((operation) => typeof object[operation] !== "function")

const wrongFields = (object: Record<string, unknown>, fields: Record<string, "array" | "object"> = {}) =>
  Object.entries(fields)
    .filter(([field, type]) => {
      const value = object[field]
      return type === "array"
        ? !Array.isArray(value)
        : typeof value !== "object" || value === null || Array.isArray(value)
    })
    .map(([field]) => field)

export async function loadAdapter(kit: Kit, kind: Kind, value: string, o: LoadOptions = {}): Promise<unknown> {
  const what = isPath(value) ? `the ${kind} ${value}` : `the ${kind} "${value}"`
  const make = await factoryOf(kind, value, o.base ?? dirname(configPath()), what)
  if (typeof make !== "function") throw new Error(`ade: ${what} must export a function (kit => adapter)`)
  const adapter = (await make(kit)) as Record<string, unknown>
  if (typeof adapter !== "object" || adapter === null) throw new Error(`ade: ${what} returned no adapter`)
  if (adapter.api !== API)
    throw new Error(`ade: ${what} is written for api ${adapter.api}; this ade-kit has api ${API}`)
  const lacks = [
    ...(typeof adapter.name === "string" ? [] : ["name"]),
    ...missing(adapter, KINDS[kind].required),
    ...wrongFields(adapter, KINDS[kind].fields),
  ]
  if (lacks.length) throw new Error(`ade: ${what} lacks: ${lacks.join(", ")}`)
  return adapter
}

// The configured multiplexer, or undefined for "none".
export async function loadMultiplexer(kit: Kit, o: LoadOptions = {}): Promise<MultiplexerAdapter | undefined> {
  const value = kit.config.multiplexer
  if (value === "none") return undefined
  const adapter = (await loadAdapter(kit, "multiplexer", value, o)) as MultiplexerAdapter
  return {
    ...adapter,
    connect: (where) => {
      const mux = adapter.connect(where)
      const lacks = missing(mux as unknown as Record<string, unknown>, MULTIPLEXER_REQUIRED)
      if (lacks.length) throw new Error(`ade: the multiplexer "${adapter.name}" lacks: ${lacks.join(", ")}`)
      return mux as Multiplexer
    },
  }
}

export const loadEditor = async (kit: Kit, o: LoadOptions = {}) =>
  (await loadAdapter(kit, "editor", kit.config.editor, o)) as Editor

export const loadAgent = async (kit: Kit, o: LoadOptions = {}) =>
  (await loadAdapter(kit, "agent", kit.config.agent, o)) as Agent

export const loadReviewer = async (kit: Kit, o: LoadOptions = {}) =>
  (await loadAdapter(kit, "reviewer", kit.config.reviewer, o)) as Reviewer

// Where worktrees go (see worktrees.ts's layoutFor for a repository's).
export const loadLayout = async (kit: Kit, value = kit.config.worktrees.layout, o: LoadOptions = {}) =>
  (await loadAdapter(kit, "layout", value, o)) as Layout

// An adapter's name in messages.
export const labelOf = (adapter: { name: string; label?: string }) => adapter.label ?? adapter.name
