/** @jsxImportSource @opentui/solid */

import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
} from "@opencode-ai/plugin/tui";

const MESSAGE_LIMIT = 10;
const CONTEXT_CHAR_LIMIT = 8_000;
const ANSWER_CHAR_LIMIT = 6_000;

type HistoryMessage = {
  info: { role: string };
  parts: Array<{
    type: string;
    text?: string;
    synthetic?: boolean;
    ignored?: boolean;
  }>;
};

type SideSession = {
  id: string;
  directory: string;
  workspace?: string;
  deleted?: boolean;
  model?: {
    providerID: string;
    id: string;
    variant?: string;
  };
};

type ConversationTurn = {
  question: string;
  answer: string;
};

function recentContext(messages: HistoryMessage[]) {
  const turns = messages.flatMap((message) => {
    if (message.info.role !== "user" && message.info.role !== "assistant")
      return [];

    const text = message.parts
      .filter(
        (part) => part.type === "text" && !part.synthetic && !part.ignored,
      )
      .map((part) => part.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n");

    return text ? [`[${message.info.role}]\n${text}`] : [];
  });

  const selected: string[] = [];
  let remaining = CONTEXT_CHAR_LIMIT;

  for (let index = turns.length - 1; index >= 0 && remaining > 0; index--) {
    const turn = turns[index];
    const clipped = turn.length <= remaining ? turn : turn.slice(0, remaining);
    selected.unshift(clipped);
    remaining -= clipped.length + 2;
  }

  return selected.join("\n\n");
}

function initialPrompt(question: string, context: string) {
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
  ].join("\n");
}

function followUpPrompt(question: string) {
  return [
    "Answer this follow-up to the side conversation.",
    "Do not modify files. Use only read-only tools if additional evidence is needed.",
    "Answer directly in no more than 200 words.",
    "",
    "<follow_up_question>",
    question,
    "</follow_up_question>",
  ].join("\n");
}

function answerText(parts: Array<{ type: string; text?: string }>) {
  const answer = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();

  if (!answer) throw new Error("The isolated session returned an empty answer");
  return answer.length <= ANSWER_CHAR_LIMIT
    ? answer
    : `${answer.slice(0, ANSWER_CHAR_LIMIT)}\n\n[Answer truncated]`;
}

async function promptSession(
  api: TuiPluginApi,
  session: SideSession,
  prompt: string,
) {
  const response = await api.client.session.prompt({
    sessionID: session.id,
    directory: session.directory,
    workspace: session.workspace,
    agent: "general",
    ...(session.model
      ? {
          model: {
            providerID: session.model.providerID,
            modelID: session.model.id,
          },
          variant: session.model.variant,
        }
      : {}),
    parts: [{ type: "text", text: prompt }],
  });
  if (response.error || !response.data)
    throw new Error("The isolated session did not return an answer");
  return answerText(response.data.parts);
}

async function deleteSession(api: TuiPluginApi, session: SideSession) {
  if (session.deleted) return;
  session.deleted = true;

  try {
    const deleted = await api.client.session.delete({
      sessionID: session.id,
      directory: session.directory,
      workspace: session.workspace,
    });
    if (deleted.error)
      console.warn("[btw] Failed to delete temporary session", deleted.error);
  } catch (error) {
    console.warn("[btw] Failed to delete temporary session", error);
  }
}

async function startSession(
  api: TuiPluginApi,
  parentSessionID: string,
  question: string,
) {
  const directory = api.state.path.directory;
  const parent = api.state.session.get(parentSessionID);
  const workspace = parent?.workspaceID;
  const history = await api.client.session.messages({
    sessionID: parentSessionID,
    directory,
    workspace,
    limit: MESSAGE_LIMIT,
  });
  if (history.error || !history.data)
    throw new Error("Could not read the active session");

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
  });
  if (created.error || !created.data)
    throw new Error("Could not create the isolated session");

  const session: SideSession = {
    id: created.data.id,
    directory,
    workspace,
    model: parent?.model,
  };

  try {
    const answer = await promptSession(
      api,
      session,
      initialPrompt(question, recentContext(history.data as HistoryMessage[])),
    );
    return { session, answer };
  } catch (error) {
    await deleteSession(api, session);
    throw error;
  }
}

function showConversation(
  api: TuiPluginApi,
  session: SideSession,
  turns: ConversationTurn[],
) {
  let busy = false;

  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title: "BTW",
      description: () => (
        <box flexDirection="column" gap={1}>
          <scrollbox
            height={16}
            stickyScroll={true}
            stickyStart="bottom"
            scrollbarOptions={{ showArrows: true }}
          >
            <box flexDirection="column" gap={1} paddingRight={1}>
              {turns.map((turn) => (
                <box flexDirection="column">
                  <text wrapMode="word">You: {turn.question}</text>
                  <text wrapMode="word">BTW: {turn.answer}</text>
                </box>
              ))}
            </box>
          </scrollbox>
          <text>Ask a follow-up, or press Esc to close.</text>
        </box>
      ),
      placeholder: "Follow-up question",
      onConfirm(value) {
        const question = value.trim();
        if (!question || busy) return;

        busy = true;
        api.ui.toast({
          variant: "info",
          title: "BTW",
          message: "Thinking about the follow-up...",
        });
        void promptSession(api, session, followUpPrompt(question)).then(
          (nextAnswer) => {
            if (!session.deleted) {
              showConversation(api, session, [
                ...turns,
                { question, answer: nextAnswer },
              ]);
            }
          },
          (error) => {
            busy = false;
            if (session.deleted) return;
            console.error("[btw] Follow-up failed", error);
            api.ui.toast({
              variant: "error",
              title: "BTW follow-up failed",
              message: error instanceof Error ? error.message : String(error),
            });
          },
        );
      },
      onCancel() {
        void deleteSession(api, session);
      },
    }),
  );
  api.ui.dialog.setSize("large");
}

function openQuestion(api: TuiPluginApi) {
  const route = api.route.current;
  if (
    route.name !== "session" ||
    !("params" in route) ||
    typeof route.params?.sessionID !== "string"
  ) {
    api.ui.toast({
      variant: "warning",
      title: "BTW",
      message: "Open a session before asking a side question.",
    });
    return;
  }

  const parentSessionID = route.params.sessionID;
  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title: "Ask BTW",
      placeholder: "Side question",
      onConfirm(value) {
        const question = value.trim();
        if (!question) {
          api.ui.toast({
            variant: "warning",
            title: "BTW",
            message: "Enter a question first.",
          });
          return;
        }

        api.ui.dialog.clear();
        api.ui.toast({
          variant: "info",
          title: "BTW",
          message: "Thinking in an isolated session...",
        });

        void startSession(api, parentSessionID, question).then(
          ({ session, answer }) =>
            showConversation(api, session, [{ question, answer }]),
          (error) => {
            console.error("[btw] Side question failed", error);
            api.ui.dialog.replace(() =>
              api.ui.DialogAlert({
                title: "BTW failed",
                message: error instanceof Error ? error.message : String(error),
              }),
            );
            api.ui.dialog.setSize("large");
          },
        );
      },
    }),
  );
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
          openQuestion(api);
        },
      },
    ],
  });
};

export default {
  id: "local.btw",
  tui,
} satisfies TuiPluginModule;
