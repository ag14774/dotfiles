// Every interface of ade-kit. Adapters of your own can import these types
// (`import type`): type imports disappear when Node strips the types, so
// nothing has to resolve when they run.

// A Git worktree, and the name derived from its path for programs with their
// own remote control (see workspace.ts).
export type Workspace = { dir: string; session: string }

// A multiplexer location: its session, and the caller's pane when it is known
// (Zellij always says; a script run with only the session may not).
export type Where = { session: string; pane?: string }

// What a pane is for, from its name (see the multiplexer's options).
export type Role = "agent" | "editor" | "shell" | "review"

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

// A key typed into a pane: text, or a named key.
export type Key = { text: string } | { key: "escape" | "enter" }

// What an adapter gets to reach its program: always the workspace; the
// multiplexer and the program's pane when there is a multiplexer.
export type Reach = { workspace: Workspace; mux?: Multiplexer; pane?: string }

// A multiplexer adapter answers "what is there" and acts on intents; layout
// workarounds stay inside it.
export type MultiplexerAdapter = {
  api: 1
  name: string
  label?: string // its name in messages, such as "Zellij" (default: name)
  // The caller's location, when it runs inside this multiplexer.
  here(env: Record<string, string | undefined>): Where | undefined
  // Act in that session (and for that pane), from anywhere: the server part of
  // a plugin has no multiplexer environment of its own.
  connect(where: Where): Multiplexer
}

export interface Multiplexer {
  panes(): Promise<Pane[]>
  tabs(): Promise<Tab[]>
  // Start `argv` in the tab's pane for `role`: a new pane (only in the tab
  // you are on), or in place of the pane `replace` (a stopped one, or a new
  // tab's agent pane), in the folder `cwd` if given. Returns its ID.
  start(o: { tab: string; role: Role; argv: string[]; focus: boolean; replace?: string; cwd?: string }): Promise<string>
  type(pane: string, keys: Key[]): Promise<void>
  // Paste as a terminal does (bracketed), so nothing is submitted.
  paste(pane: string, text: string): Promise<void>
  focus(pane: string): Promise<void>
  // Optional, for a tab per worktree (ade workspace): a new tab in the
  // worktree `dir` with the layout's panes (the agent's and the shell's),
  // named after it, in front or in the background. Returns its ID.
  openTab?(o: { dir: string; focus: boolean }): Promise<string>
  showTab?(tab: string): Promise<void> // bring it to the front
  closeTab?(tab: string): Promise<void>
}

// A file to open, with the place to show when the editor supports it.
export type FileRef = { path: string; line?: number; column?: number }

export type EditorSupports = {
  line: boolean // opens a file at a line
  reload: "watches" | "command" | "none" // how it learns of files changed on disk
  remote: boolean // has its own remote control (opens files without a multiplexer)
}

export interface Editor {
  api: 1
  name: string
  label?: string
  programs: string[] // the first on PATH starts it
  supports: EditorSupports
  // The command that starts it on `files` (under the workspace's derived name,
  // for an editor with remote control).
  start(files: FileRef[], workspace: Workspace): string[]
  running?(workspace: Workspace): Promise<boolean> // remote control: is it up?
  open(files: FileRef[], reach: Reach): Promise<void>
  reload?(reach: Reach): Promise<void> // reload: "command"
}

// typedEditor (editor.ts): an editor reached by typing into its pane.
export type TypedEditorOptions = {
  name: string
  label?: string
  programs: string[]
  start?(files: FileRef[], workspace: Workspace): string[] // default: the program and the paths
  open(file: FileRef): Key[] // the keys that open one file
  reload?(): Key[]
  supports: Omit<EditorSupports, "remote">
}

export interface Agent {
  api: 1
  name: string
  label?: string
  start(o: { session?: string; prompt?: string }): string[] // the command for its pane
  // Put text in the agent's input, for you to finish and send (a selection,
  // with your question to come).
  insert(text: string, reach: Reach): Promise<void>
  // Send text as a message (review comments).
  submit(text: string, reach: Reach): Promise<void>
  // Whether a command was run by the agent's own tools, which run outside its
  // pane (with a pane ID passed along that may not be theirs).
  ranByAgent?(env: Record<string, string | undefined>): boolean
}

// pasteAgent (agent.ts): an agent reached by pasting into its pane.
export type PasteAgentOptions = {
  name: string
  label?: string
  start(o: { session?: string; prompt?: string }): string[]
}

// What a review covers: the commits since the merge base with origin/HEAD
// (`base`), and uncommitted changes (new files included). In a wtreview
// worktree, HEAD is the merge base, so only `uncommitted` is set: the PR plus
// your edits.
export type Scope = { dir: string; base?: string; commits: boolean; uncommitted: boolean }

export interface Reviewer {
  api: 1
  name: string
  label?: string
  // The command for an interactive review of `scope`, run in `scope.dir`.
  // When you end it, the comments for the agent come out on stdout (nothing:
  // nothing to send).
  command(scope: Scope): string[]
  // The environment variable its "open this file" key uses (tuicr: EDITOR),
  // set to `ade open` so files open in the tab's editor.
  editorVariable?: string
}

// The ADE config (config.ts): choices, and options sections for adapters.
export type ZellijOptions = {
  layout: string
  panes: Record<Role, string> // pane names, by role
  // The name of a worktree's tab (see Kit's tabName): "{project}: {worktree}"
  // groups each project's tabs in ade-zjstatus. Names are only shown: tabs
  // are found by their panes' folders.
  tabName: string
}
export type Config = {
  // Each choice: a built-in name, or a path to a module of your own.
  multiplexer: string // or "none"
  editor: string
  agent: string
  reviewer: string
  // How review comments reach the agent: "insert" fills in its input for you
  // to send, "submit" sends them.
  review: { deliver: "insert" | "submit" }
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
  // Quoted for an editor's command line, a quote inside doubled.
  quote: {
    double(text: string): string // "...", with "" for a " inside
    single(text: string): string // '...', with '' for a ' inside
  }
  keys: { escape: Key; enter: Key; text(text: string): Key }
  // A tab's name for the worktree `dir`, from a template: {worktree} is the
  // worktree folder's name, {project} its repository's root folder's.
  tabName(template: string, dir: string): Promise<string>
  typedEditor(o: TypedEditorOptions): Editor
  pasteAgent(o: PasteAgentOptions): Agent
  // The built-in adapters, to start from.
  builtin: { editor(name: string): Editor; agent(name: string): Agent; reviewer(name: string): Reviewer }
}
