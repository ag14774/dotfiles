import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { configPath, DEFAULTS, readConfig } from "../src/config.ts"

// An XDG_CONFIG_HOME whose ade/config.json holds `text` (none if undefined).
const configHome = (text?: string) => {
  const home = mkdtempSync(join(tmpdir(), "ade-config-"))
  if (text !== undefined) {
    mkdirSync(join(home, "ade"))
    writeFileSync(join(home, "ade", "config.json"), text)
  }
  return home
}

test("the defaults: Zellij, Helix, OpenCode, tuicr, the bare layout", () => {
  assert.deepEqual(DEFAULTS, {
    multiplexer: "zellij",
    editor: "helix",
    agent: "opencode",
    reviewer: "tuicr",
    review: { deliver: "insert" },
    worktrees: { layout: "bare", base: "origin/HEAD", seed: [".env", ".env.*", ".envrc", "pyrightconfig.json"] },
  })
})

test("without a config file, the defaults apply (as a copy)", () => {
  const config = readConfig({ XDG_CONFIG_HOME: configHome() })
  assert.deepEqual(config, DEFAULTS)
  config.worktrees.seed.push("changed")
  assert.deepEqual(DEFAULTS.worktrees.seed, [".env", ".env.*", ".envrc", "pyrightconfig.json"])
})

test("the config file is found through XDG_CONFIG_HOME, else ~/.config", () => {
  assert.equal(configPath({ XDG_CONFIG_HOME: "/x/config", HOME: "/home/me" }), "/x/config/ade/config.json")
  assert.equal(configPath({ HOME: "/home/me" }), "/home/me/.config/ade/config.json")
  assert.equal(configPath({ XDG_CONFIG_HOME: "relative", HOME: "/home/me" }), "/home/me/.config/ade/config.json")
  assert.equal(configPath({ ADE_CONFIG: "/t/ade.json", XDG_CONFIG_HOME: "/x/config" }), "/t/ade.json")
  assert.equal(configPath({ ADE_CONFIG: "relative.json", HOME: "/home/me" }), "/home/me/.config/ade/config.json")
})

test("settings merge into the defaults key by key, and other sections are kept", () => {
  const settings = {
    worktrees: { base: "origin/develop" },
    zellij: { panes: { agent: "claude" } },
    opencode: { command: ["opencode-pane"] },
  }
  const config = readConfig({ XDG_CONFIG_HOME: configHome(JSON.stringify(settings)) })
  assert.deepEqual(config.worktrees, {
    layout: "bare",
    base: "origin/develop",
    seed: [".env", ".env.*", ".envrc", "pyrightconfig.json"],
  })
  assert.deepEqual(config.zellij, { panes: { agent: "claude" } })
  assert.equal(config.multiplexer, "zellij")
  assert.deepEqual(config.opencode, { command: ["opencode-pane"] })
})

test("a broken config file is refused, naming the file and the problem", () => {
  const broken = configHome("{ multiplexer: zellij }")
  assert.throws(
    () => readConfig({ XDG_CONFIG_HOME: broken }),
    (error: Error) =>
      error.message.includes(join(broken, "ade", "config.json")) && error.message.includes("not valid JSON"),
  )
  assert.throws(() => readConfig({ XDG_CONFIG_HOME: configHome("[1, 2]") }), /must hold a JSON object/)
  assert.throws(
    () => readConfig({ XDG_CONFIG_HOME: configHome('{"multiplexer": 1, "editor": [], "agent": {}, "reviewer": 2}') }),
    /these must be strings: multiplexer, editor, agent, reviewer$/,
  )
  assert.throws(
    () => readConfig({ XDG_CONFIG_HOME: configHome('{"review": {"deliver": "send"}}') }),
    /review\.deliver must be "insert" or "submit"$/,
  )
  assert.throws(
    () => readConfig({ XDG_CONFIG_HOME: configHome('{"worktrees": {"layout": 1, "base": null}}') }),
    /strings: worktrees\.layout, worktrees\.base$/,
  )
  assert.throws(
    () => readConfig({ XDG_CONFIG_HOME: configHome('{"worktrees": {"seed": ".env"}}') }),
    /worktrees\.seed must be a list of strings$/,
  )
  assert.equal(
    readConfig({ XDG_CONFIG_HOME: configHome('{"review": {"deliver": "submit"}}') }).review.deliver,
    "submit",
  )
})
