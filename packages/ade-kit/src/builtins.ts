// The built-in adapters, by kind and name: what a config's choice names when
// it isn't a path (load.ts), and what Kit's builtin offers to start from.
import opencode from "./agents/opencode.ts"
import helix from "./editors/helix.ts"
import mitos from "./editors/mitos.ts"
import bare from "./layouts/bare.ts"
import inside from "./layouts/inside.ts"
import sibling from "./layouts/sibling.ts"
import zellij from "./multiplexers/zellij.ts"
import tuicr from "./reviewers/tuicr.ts"
import type { Agent, Editor, Kit, Layout, MultiplexerAdapter, Reviewer } from "./types.ts"

export type Kind = "multiplexer" | "editor" | "agent" | "reviewer" | "layout"

type Builtins = {
  multiplexer: Record<string, (kit: Kit) => MultiplexerAdapter>
  editor: Record<string, (kit: Kit) => Editor>
  agent: Record<string, (kit: Kit) => Agent>
  reviewer: Record<string, (kit: Kit) => Reviewer>
  layout: Record<string, (kit: Kit) => Layout>
}

// A function, so nothing is read while the modules load: the bare layout and
// the worktree commands import each other through here.
export const builtins = <K extends Kind>(kind: K): Builtins[K] =>
  ({
    multiplexer: { zellij },
    editor: { helix, mitos },
    agent: { opencode },
    reviewer: { tuicr },
    layout: { bare, sibling, inside },
  })[kind]

// The built-in `kind` named `name`, made for `kit`.
export function builtin<K extends Kind>(kind: K, name: string, kit: Kit): ReturnType<Builtins[K][string]> {
  const adapters: Record<string, (kit: Kit) => unknown> = builtins(kind)
  const make = Object.hasOwn(adapters, name) ? adapters[name] : undefined
  if (!make) throw new Error(`ade: there is no built-in ${kind} named "${name}"`)
  return make(kit) as ReturnType<Builtins[K][string]>
}
