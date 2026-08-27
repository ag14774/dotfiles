import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"

const MESSAGE_LIMIT = 10
const CONTEXT_CHAR_LIMIT = 8_000
const ANSWER_CHAR_LIMIT = 6_000

type HistoryMessage = {
  info: { role: string }
  parts: Array<{
    type: string
    text?: string
    synthetic?: boolean
    ignored?: boolean
  }>
}

function recentContext(messages: HistoryMessage[]) {
  const turns = messages.flatMap((message) => {
    if (message.info.role !== "user" && message.info.role !== "assistant") return []

    const text = message.parts
      .filter((part) => part.type === "text" && !part.synthetic && !part.ignored)
      .map((part) => part.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n")

    return text ? [`[${message.info.role}]\n${text}`] : []
  })

  const selected: string[] = []
  let remaining = CONTEXT_CHAR_LIMIT

  for (let index = turns.length - 1; index >= 0 && remaining > 0; index--) {
    const turn = turns[index]
    const clipped = turn.length <= remaining ? turn : turn.slice(0, remaining)
    selected.unshift(clipped)
    remaining -= clipped.length + 2
  }

  return selected.join("\n\n")
}

function promptText(question: string, context: string) {
  return [
    "Answer this side question independently from the main conversation.",
    "Use the conversation excerpt only as background context.",
    "Do not modify files. Use only read-only tools if additional evidence is needed.",
    "Answer directly in no more than 200 words.",
    "",
    "<conversation_context>",
    context || "No previous conversational text was available.",
    "</conversation_context>",
    "",
    "<side_question>",
    question,
    "</side_question>",
  ].join("\n")
}

function showAnswer(api: TuiPluginApi, title: string, message: string) {
  api.ui.dialog.replace(() => api.ui.DialogAlert({ title, message }))
  api.ui.dialog.setSize("large")
}

async function ask(api: TuiPluginApi, parentSessionID: string, question: string) {
  const directory = api.state.path.directory
  const parent = api.state.session.get(parentSessionID)
  const workspace = parent?.workspaceID
  let sideSessionID: string | undefined

  try {
    const history = await api.client.session.messages({
      sessionID: parentSessionID,
      directory,
      workspace,
      limit: MESSAGE_LIMIT,
    })
    if (history.error || !history.data) throw new Error("Could not read the active session")

    const created = await api.client.session.create({
      directory,
      workspace,
      title: `BTW: ${question.replace(/\s+/g, " ").slice(0, 60)}`,
      agent: "general",
      ...(parent?.model ? { model: parent.model } : {}),
      permission: [
        { permission: "*", pattern: "*", action: "deny" },
        { permission: "read", pattern: "*", action: "allow" },
        { permission: "glob", pattern: "*", action: "allow" },
        { permission: "grep", pattern: "*", action: "allow" },
        { permission: "lsp", pattern: "*", action: "allow" },
        { permission: "webfetch", pattern: "*", action: "allow" },
        { permission: "websearch", pattern: "*", action: "allow" },
      ],
    })
    if (created.error || !created.data) throw new Error("Could not create the isolated session")
    sideSessionID = created.data.id

    const response = await api.client.session.prompt({
      sessionID: sideSessionID,
      directory,
      workspace,
      agent: "general",
      ...(parent?.model
        ? {
            model: {
              providerID: parent.model.providerID,
              modelID: parent.model.id,
            },
            variant: parent.model.variant,
          }
        : {}),
      parts: [
        {
          type: "text",
          text: promptText(question, recentContext(history.data as HistoryMessage[])),
        },
      ],
    })
    if (response.error || !response.data) throw new Error("The isolated session did not return an answer")

    const answer = response.data.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n")
      .trim()

    if (!answer) throw new Error("The isolated session returned an empty answer")
    return answer.length <= ANSWER_CHAR_LIMIT ? answer : `${answer.slice(0, ANSWER_CHAR_LIMIT)}\n\n[Answer truncated]`
  } finally {
    if (sideSessionID) {
      try {
        const deleted = await api.client.session.delete({ sessionID: sideSessionID, directory, workspace })
        if (deleted.error) console.warn("[btw] Failed to delete temporary session", deleted.error)
      } catch (error) {
        console.warn("[btw] Failed to delete temporary session", error)
      }
    }
  }
}

function openQuestion(api: TuiPluginApi) {
  const route = api.route.current
  if (route.name !== "session" || !("params" in route) || typeof route.params?.sessionID !== "string") {
    api.ui.toast({ variant: "warning", title: "BTW", message: "Open a session before asking a side question." })
    return
  }

  const parentSessionID = route.params.sessionID
  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title: "Ask BTW",
      placeholder: "Side question",
      onConfirm(value) {
        const question = value.trim()
        if (!question) {
          api.ui.toast({ variant: "warning", title: "BTW", message: "Enter a question first." })
          return
        }

        api.ui.dialog.clear()
        api.ui.toast({ variant: "info", title: "BTW", message: "Thinking in an isolated session..." })

        void ask(api, parentSessionID, question).then(
          (answer) => showAnswer(api, "BTW", answer),
          (error) => {
            console.error("[btw] Side question failed", error)
            showAnswer(api, "BTW failed", error instanceof Error ? error.message : String(error))
          },
        )
      },
    }),
  )
}

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "btw.ask",
        title: "Ask a side question",
        desc: "Ask in an isolated, temporary session",
        category: "Session",
        namespace: "palette",
        slashName: "btw",
        run() {
          openQuestion(api)
        },
      },
    ],
  })
}

export default {
  id: "local.btw",
  tui,
} satisfies TuiPluginModule
