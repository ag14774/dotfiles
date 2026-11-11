// A choice from the config -> an adapter, checked. A built-in name loads
// the built-in module; a path (starting with "/", "./", "../", "~/" or
// "file:") loads that file, relative paths from the config's folder. The
// module's default export gets the kit and returns the adapter.
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { configPath } from "./config.ts"
import type { Kit, Multiplexer, MultiplexerAdapter } from "./types.ts"

export const API = 1

type Kind = "multiplexer"
// Per kind: the folder of the built-ins, and the operations an adapter needs.
const KINDS: Record<Kind, { dir: string; required: string[] }> = {
  multiplexer: { dir: "multiplexers", required: ["here", "connect"] },
}
// What a connected multiplexer must do (the rest is optional).
const MULTIPLEXER_REQUIRED = ["panes", "tabs"]

export type LoadOptions = { base?: string } // the folder relative paths start from

const isPath = (value: string) => /^(\/|\.\.?\/|~\/|file:)/.test(value)

const urlOf = (kind: Kind, value: string, base: string) => {
  if (value.startsWith("file:")) return value
  if (value.startsWith("~/")) return pathToFileURL(join(homedir(), value.slice(2))).href
  if (isPath(value)) return pathToFileURL(resolve(base, value)).href
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error(`ade: "${value}" is neither a built-in ${kind} nor a path`)
  const url = new URL(`./${KINDS[kind].dir}/${value}.ts`, import.meta.url)
  if (!existsSync(fileURLToPath(url))) throw new Error(`ade: there is no built-in ${kind} named "${value}"`)
  return url.href
}

const missing = (object: Record<string, unknown>, operations: string[]) =>
  operations.filter((operation) => typeof object[operation] !== "function")

export async function loadAdapter(kit: Kit, kind: Kind, value: string, o: LoadOptions = {}): Promise<unknown> {
  const what = isPath(value) ? `the ${kind} ${value}` : `the ${kind} "${value}"`
  const url = urlOf(kind, value, o.base ?? dirname(configPath()))
  let module: { default?: unknown }
  try {
    module = await import(url)
  } catch (error) {
    throw new Error(`ade: cannot load ${what}: ${(error as Error).message}`)
  }
  if (typeof module.default !== "function") throw new Error(`ade: ${what} must export a function (kit => adapter)`)
  const adapter = (await module.default(kit)) as Record<string, unknown>
  if (typeof adapter !== "object" || adapter === null) throw new Error(`ade: ${what} returned no adapter`)
  if (adapter.api !== API) throw new Error(`ade: ${what} is written for api ${adapter.api}; this ade-kit has api ${API}`)
  const lacks = [...(typeof adapter.name === "string" ? [] : ["name"]), ...missing(adapter, KINDS[kind].required)]
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
