/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import type { SessionMessageInfo } from "@opencode/client";
import { createSignal, onCleanup } from "solid-js";

const CONTEXT_LIMIT = 8_000;
const ANSWER_LIMIT = 6_000;

function recentContext(messages: SessionMessageInfo[]) {
  const turns = messages.flatMap((message) => {
    const text = message.type === "user"
      ? message.text
      : message.type === "assistant"
        ? message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
        : "";
    return text.trim() ? [`[${message.type}]\n${text.trim()}`] : [];
  });
  return turns.join("\n\n").slice(-CONTEXT_LIMIT);
}

async function answer(context: Context, sessionID: string, text: string) {
  await context.client.session.prompt({ sessionID, text });
  await context.client.session.wait({ sessionID });
  const messages = await context.client.message.list({ sessionID, order: "desc", limit: 100 });
  const latest = [];
  for (const message of messages.data) {
    if (message.type === "user") break;
    if (message.type !== "assistant") continue;
    if (message.error) throw new Error(message.error.message);
    latest.unshift(message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"));
  }
  const result = latest.join("\n\n").trim();
  if (!result) throw new Error("The isolated session returned an empty answer");
  return result.length > ANSWER_LIMIT ? `${result.slice(0, ANSWER_LIMIT)}\n[Answer truncated]` : result;
}

function conversation(context: Context, sessionID: string, question: string, initial: string, close: () => void) {
  context.ui.dialog.show(() => {
    const [turns, setTurns] = createSignal([{ question, answer: initial }]);
    const [busy, setBusy] = createSignal(false);
    const [input, setInput] = createSignal("");
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    const submit = async () => {
      const question = input().trim();
      if (!question || busy()) return;
      setBusy(true);
      try {
        const result = await answer(context, sessionID, [
          "Answer this side-conversation follow-up in at most 200 words.",
          "Do not modify files; use only read-only tools.", question,
        ].join("\n\n"));
        if (controller.signal.aborted) return;
        setTurns((turns) => [...turns, { question, answer: result }]);
        setInput("");
      } catch (error) {
        if (!controller.signal.aborted) context.ui.toast.show({ variant: "error", message: String(error) });
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    };
    context.keymap.layer(() => ({ mode: "modal", commands: [{ bind: "return", run: submit }] }));
    return (
      <box flexDirection="column" gap={1} padding={1}>
        <text>BTW — Esc closes the temporary conversation</text>
        <scrollbox height={16} stickyScroll stickyStart="bottom">
          <box flexDirection="column" gap={1}>
            {turns().map((turn) => <box flexDirection="column">
              <text wrapMode="word">You: {turn.question}</text>
              <text wrapMode="word">BTW: {turn.answer}</text>
            </box>)}
          </box>
        </scrollbox>
        <text>{busy() ? "Thinking..." : "Follow-up question (Enter to send)"}</text>
        <input focused={!busy()} value={input()} onInput={setInput} />
      </box>
    );
  }, close);
  context.ui.dialog.set({ size: "large", centered: true });
}

export default Plugin.define({
  id: "local.btw",
  setup(context) {
    const sessions = new Set<string>();
    let disposed = false;
    const remove = async (sessionID: string) => {
      if (!sessions.delete(sessionID)) return;
      try {
        await context.client.session.interrupt({ sessionID });
      } finally {
        await context.client.session.remove({ sessionID });
      }
    };
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "local.btw.ask", title: "Ask a side question", group: "Session", palette: true,
        slash: { name: "btw", arguments: true },
        async run(input) {
          const route = context.ui.router.current();
          if (route.type !== "session") {
            context.ui.toast.show({ variant: "warning", message: "Open a session first." });
            return;
          }
          const question = input?.trim() || await context.ui.dialog.prompt({ title: "Ask BTW", placeholder: "Side question" });
          if (!question?.trim() || disposed) return;
          let sessionID: string | undefined;
          try {
            const parent = await context.client.session.get({ sessionID: route.sessionID });
            const history = await context.client.message.list({ sessionID: route.sessionID, order: "desc", limit: 10 });
            const session = await context.client.session.create({
              location: parent.location, model: parent.model, agent: "general",
              title: `BTW: ${question.replace(/\s+/g, " ").slice(0, 60)}`,
              permissions: [
                { action: "*", resource: "*", effect: "deny" },
                ...["read", "glob", "grep", "webfetch", "websearch"].map((action) => ({ action, resource: "*", effect: "allow" as const })),
              ],
            });
            sessionID = session.id;
            sessions.add(sessionID);
            if (disposed) { await remove(sessionID); return; }
            const result = await answer(context, sessionID, [
              "Answer this side question independently in at most 200 words.",
              "Do not modify files; use only read-only tools.",
              `<conversation_context>\n${recentContext([...history.data].reverse())}\n</conversation_context>`,
              `<side_question>\n${question}\n</side_question>`,
            ].join("\n\n"));
            if (disposed) return;
            const id = sessionID;
            conversation(context, id, question, result, () => { void remove(id).catch(console.error); });
          } catch (error) {
            if (sessionID) await remove(sessionID).catch(console.error);
            if (!disposed) context.ui.toast.show({ variant: "error", title: "BTW failed", message: String(error) });
          }
        },
      }],
    }));
    return () => {
      disposed = true;
      for (const sessionID of sessions) void remove(sessionID).catch(console.error);
    };
  },
});
