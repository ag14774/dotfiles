// OpenCode's own attention plugin (opencode.notifications) plays a sound, and
// shows a system notification, for every conversation's events in every
// OpenCode app connected to the service: with an app in each tab, an event
// sounds once per tab. These are its rules (OpenCode 2.2.5), for only the
// conversations the app shows and their subagents, through the same
// attention.notify (so the same sounds, volume and focus rules). They apply
// only while the built-in plugin is switched off ("-opencode.notifications"
// in cli.json's plugins), so the two never both play.

export type Sound = "question" | "permission" | "error" | "done" | "subagent_done"

export type Notice = {
  title?: string
  message: string
  notification: false | { when: "blurred" }
  sound: { name: Sound; when: "always" }
}

export type Toast = { sessionID: string; title: string; message: string; variant: "error" }

// The parts of the plugin context used here.
export type Host = {
  on(type: string, listener: (event: { data: any }) => void): () => void
  session: {
    get(id: string): { parentID?: string; title?: string } | undefined
    family(id: string): readonly string[]
    status(id: string): string | undefined
  }
  notify(notice: Notice): unknown
  toast(toast: Toast): void
}

export function attend(
  host: Host,
  o: {
    mine: (sessionID: string) => boolean // a conversation this app shows, or one of their subagents
    active: () => boolean // the built-in plugin is off
  },
): () => void {
  const { session } = host
  const alert = (sessionID: string, message: string, sound: Sound, title?: string) => {
    if (!o.active() || !o.mine(sessionID)) return
    const info = session.get(sessionID)
    host.notify({
      title: title ?? info?.title,
      message,
      notification: info?.parentID !== undefined ? false : { when: "blurred" },
      sound: { name: sound, when: "always" },
    })
  }
  // A conversation isn't done while one of its subagents still runs.
  const waiting = (id: string) =>
    session.family(id).some((m) => m !== id && session.get(m)?.parentID === id && session.status(m) === "running")

  const failed = new Set<string>()
  const ended = new Set<string>()
  const forms = new Set<string>()
  const asks = new Set<string>()
  const end = (id: string) => {
    if (ended.has(id)) return
    ended.add(id)
    if (failed.delete(id)) return
    alert(id, "Session done", session.get(id)?.parentID ? "subagent_done" : "done")
  }
  const stops = [
    host.on("form.created", ({ data }) => {
      if (forms.has(data.form.id)) return
      forms.add(data.form.id)
      alert(data.form.sessionID, "Input needs response", "question", data.form.title)
    }),
    host.on("form.replied", ({ data }) => void forms.delete(data.id)),
    host.on("form.cancelled", ({ data }) => void forms.delete(data.id)),
    host.on("permission.asked", ({ data }) => {
      if (asks.has(data.id)) return
      asks.add(data.id)
      alert(data.sessionID, "Permission needs input", "permission")
    }),
    host.on("permission.replied", ({ data }) => void asks.delete(data.requestID)),
    host.on("session.execution.started", ({ data }) => {
      failed.delete(data.sessionID)
      ended.delete(data.sessionID)
    }),
    host.on("session.execution.succeeded", ({ data }) => {
      if (!session.get(data.sessionID)?.parentID && waiting(data.sessionID)) return
      end(data.sessionID)
    }),
    host.on("session.execution.interrupted", ({ data }) => end(data.sessionID)),
    host.on("session.execution.failed", ({ data }) => {
      const id = data.sessionID
      if (ended.has(id)) return
      if (failed.has(id)) return end(id)
      failed.add(id)
      if (data.error.type !== "provider.free-limit" && data.error.type !== "provider.go-limit")
        alert(id, data.error.message, "error")
      // The built-in plugin's toast, in every app as before.
      if (o.active()) host.toast({ sessionID: id, title: "Session failed", message: data.error.message, variant: "error" })
      end(id)
    }),
  ]
  return () => stops.reverse().forEach((stop) => stop())
}
