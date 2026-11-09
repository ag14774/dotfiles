// Agent marks in Zellij tab names, shared by both parts of the ADE plugin: the
// app part puts its pane's mark in front of its tab's name; the server part
// counts the marks in all tab names for the totals in the top bar.

export type Mark = "none" | "waiting" | "failed" | "done" | "working"
type Shown = Exclude<Mark, "none">

// Nerd Font: bell, times-circle, check, timer-sand. Most urgent first.
export const ICONS: Record<Shown, string> = {
  waiting: "\u{F0F3}",
  failed: "\u{F057}",
  done: "\u{F00C}",
  working: "\u{F051F}",
}
export const URGENCY: readonly Shown[] = ["waiting", "failed", "done", "working"]
// Catppuccin Mocha: peach, red, green, yellow.
const COLOURS: Record<Shown, string> = { waiting: "#fab387", failed: "#f38ba8", done: "#a6e3a1", working: "#f9e2af" }

export const markOf = (name: string): Mark => URGENCY.find((mark) => name.startsWith(`${ICONS[mark]} `)) ?? "none"
export const baseName = (name: string) => (markOf(name) === "none" ? name : name.slice(name.indexOf(" ") + 1))
export const withMark = (name: string, mark: Mark) => (mark === "none" ? baseName(name) : `${ICONS[mark]} ${baseName(name)}`)

// zjstatus text (its #[...] colour syntax) counting the tabs with each mark,
// e.g. "<bell> 1  <timer-sand> 2"; empty when no tab has one.
export const totalsText = (names: readonly string[]) =>
  URGENCY.map((mark) => [mark, names.filter((name) => markOf(name) === mark).length] as const)
    .filter(([, count]) => count > 0)
    .map(([mark, count]) => `#[fg=${COLOURS[mark]}]${ICONS[mark]} ${count}`)
    .join("  ")
