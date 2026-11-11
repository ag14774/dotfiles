// Every interface of ade-kit. Adapters of your own can import these types
// (`import type`): type imports disappear when Node strips the types, so
// nothing has to resolve when they run.

// A Git worktree, and the name derived from its path for programs with their
// own remote control (see workspace.ts).
export type Workspace = { dir: string; session: string }

// A multiplexer location: its session and the caller's pane.
export type Where = { session: string; pane: string }

// What a pane is for, from its name (see the multiplexer's options).
export type Role = "agent" | "editor" | "shell" | "review"

// What a tab's agents are doing, shown on the tab (status package).
export type Mark = "none" | "working" | "waiting" | "done" | "failed"
export type ShownMark = Exclude<Mark, "none">

export type Pane = {
  id: string
  tab: string
  role?: Role
  cwd?: string
  running: boolean
  floating: boolean
  focused: boolean
}
export type Tab = { id: string; name: string; active: boolean }

// A multiplexer adapter answers "what is there" and acts on intents; layout
// workarounds stay inside it.
export type MultiplexerAdapter = {
  api: 1
  name: string
  // The caller's location, when it runs inside this multiplexer.
  here(env: Record<string, string | undefined>): Where | undefined
  // Act in that session (and for that pane), from anywhere: the server part of
  // a plugin has no multiplexer environment of its own.
  connect(where: Where): Multiplexer
}

export interface Multiplexer {
  panes(): Promise<Pane[]>
  tabs(): Promise<Tab[]>
  // Optional (status package)
  markTab?(tab: string, mark: Mark): Promise<void>
  marks?(): Promise<Map<string, Mark>> // tab ID -> mark
  showTotals?(counts: Record<ShownMark, number>): Promise<void>
}

// The ADE config (config.ts): choices, and options sections for adapters.
export type ZellijOptions = {
  layout: string
  panes: Record<Role, string> // pane names, by role
  totals: string // where the totals go: `zellij pipe` to this plugin and pipe name
}
export type Config = {
  multiplexer: string // a built-in name, a path to a module of your own, or "none"
  zellij: ZellijOptions
  [section: string]: unknown
}

export type RunOptions = { stdin?: string; cwd?: string; timeout?: number; env?: Record<string, string | undefined> }
export type RunResult = { ok: boolean; stdout: string; stderr: string }

// What adapters get, so they need no imports of their own.
export type Kit = {
  config: Config
  // Run a command (never through a shell); stdin is always closed.
  run(argv: string[], o?: RunOptions): Promise<RunResult>
}
