/** @jsxImportSource @opentui/solid */
// Adapted from OpenCode's MIT-licensed built-in BTW plugin:
// https://github.com/anomalyco/opencode/blob/v2/packages/tui/src/feature-plugins/prompt/btw.tsx
// See LICENSE. Private host UI helpers are replaced with public plugin APIs.
import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { SyntaxStyle, TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";

const instructions = [
  "The user is asking a quick side question about the conversation so far.",
  "Answer directly and concisely in markdown from what you already know.",
  "Do not call any tools and do not take any actions.",
].join(" ");

type Turn = { question: string; answer: string };

async function generate(context: Context, sessionID: string, question: string, turns: Turn[], signal: AbortSignal) {
  // Like the built-in, generate is transient: no prompt admission, tools, or
  // persisted messages. Only follow-ups include the dialog's local history.
  const prompt = turns.length
    ? [instructions, "Continue this side conversation. Answer only the new question.",
      JSON.stringify({ sideConversation: turns, question })].join("\n\n")
    : [instructions, question].join("\n\n");
  const result = await context.client.session.generate({ sessionID, prompt }, { signal });
  const answer = result.text.trim();
  if (!answer) throw new Error("BTW returned an empty answer. Try rephrasing the question.");
  return answer;
}

function Pending(props: { context: Context }) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const [frame, setFrame] = createSignal(0);
  const timer = setInterval(() => setFrame((value) => (value + 1) % frames.length), 80);
  onCleanup(() => clearInterval(timer));
  return <text fg={props.context.theme.text.base}>{frames[frame()]} /btw</text>;
}

function Conversation(props: { context: Context; sessionID: string; initial: Turn; pending: (delta: number) => void; requests: Set<AbortController> }) {
  const context = props.context;
  const [turns, setTurns] = createSignal([props.initial]);
  const [busy, setBusy] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [input, setInput] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  const controller = new AbortController();
  props.requests.add(controller);
  const dimensions = useTerminalDimensions();
  const maxHeight = createMemo(() => Math.max(4, Math.floor(dimensions().height * 0.6)));
  const syntax = SyntaxStyle.fromStyles({
    default: { fg: context.theme.text.base },
    "markup.heading": { fg: context.theme.text.base, bold: true },
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.link": { underline: true },
    "markup.raw": { fg: context.theme.text.muted },
  });
  onCleanup(() => {
    controller.abort();
    props.requests.delete(controller);
    // Release native syntax resources after the dialog's renderables unmount.
    void context.renderer.idle().catch(() => {}).finally(() => syntax.destroy());
  });
  let scroll: ScrollBoxRenderable | undefined;

  const copy = () => {
    const answer = turns()[turns().length - 1].answer;
    if (context.renderer.copyToClipboardOSC52(answer)) setCopied(true);
    else context.ui.toast.show({ variant: "error", message: "The terminal could not copy the answer." });
  };
  const submit = async () => {
    const question = input().trim();
    if (!question || busy()) return;
    setBusy(true);
    props.pending(1);
    try {
      const answer = await generate(context, props.sessionID, question, turns(), controller.signal);
      if (controller.signal.aborted) return;
      setTurns((history) => [...history, { question, answer }]);
      setInput("");
      setCopied(false);
      setEditing(false);
    } catch (error) {
      if (!controller.signal.aborted) context.ui.toast.show({ variant: "error", title: "BTW failed", message: String(error) });
    } finally {
      props.pending(-1);
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const reading = () => !editing() && !busy();
  context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      { bind: "c", title: "Copy answer", enabled: reading, run: copy },
      { bind: "ctrl+y", title: "Copy answer", run: copy },
      { bind: "f", title: "Follow up", enabled: reading, run: () => { setEditing(true); } },
      { bind: "return", title: "Follow up", enabled: reading, run: () => { setEditing(true); } },
      ...[["up", -1], ["k", -1], ["down", 1], ["j", 1]].map(([bind, amount]) => ({
        bind: String(bind), enabled: reading, run: () => { scroll?.scrollBy(Number(amount)); },
      })),
      { bind: "pageup", enabled: reading, run: () => { scroll?.scrollBy(-maxHeight()); } },
      { bind: "pagedown", enabled: reading, run: () => { scroll?.scrollBy(maxHeight()); } },
      { bind: "home", enabled: reading, run: () => { scroll?.scrollTo(0); } },
      { bind: "end", enabled: reading, run: () => { if (scroll) scroll.scrollTo(scroll.scrollHeight); } },
    ],
  }));
  return (
    <box flexDirection="column" gap={1} paddingBottom={1}>
      <box flexDirection="row" gap={2} paddingLeft={2} paddingRight={2}>
        <text attributes={TextAttributes.BOLD} fg={context.theme.text.base}>/btw</text>
        <text fg={context.theme.text.muted} flexGrow={1} truncate>{props.initial.question.replace(/\s+/g, " ")}</text>
        <text fg={context.theme.text.muted} onMouseUp={() => context.ui.dialog.clear()}>esc</text>
      </box>
      <scrollbox ref={(element: ScrollBoxRenderable) => { scroll = element; }} maxHeight={maxHeight()}
        stickyScroll stickyStart="bottom" contentOptions={{ minHeight: 0 }} scrollbarOptions={{ visible: false }}>
        <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <For each={turns()}>{(turn) => <box flexDirection="column" gap={1}>
            <text fg={context.theme.text.muted} wrapMode="word">You: {turn.question}</text>
            <markdown syntaxStyle={syntax} content={turn.answer} conceal internalBlockMode="top-level"
              tableOptions={{ style: "grid", cellPaddingX: 1 }} fg={context.theme.text.base} />
          </box>}</For>
        </box>
      </scrollbox>
      <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2}>
        <Show when={editing()}>
          <text fg={context.theme.text.muted}>{busy() ? "Thinking..." : "Follow-up question (Enter to send)"}</text>
          <input focused={!busy()} value={input()} onInput={setInput} onSubmit={() => { void submit(); }} />
        </Show>
        <box flexDirection="row" gap={3}>
          <text fg={context.theme.text.base} onMouseUp={copy}>{copied() ? "✓ copied" : editing() ? "ctrl+y copy" : "c copy"}</text>
          <Show when={!editing()}><text fg={context.theme.text.muted} onMouseUp={() => { if (!busy()) setEditing(true); }}>f/Enter follow up · j/k ↑/↓ scroll</text></Show>
        </box>
      </box>
    </box>
  );
}

export default Plugin.define({
  id: "local.btw",
  setup(context) {
    const [pending, setPending] = createSignal(0);
    const requests = new Set<AbortController>();
    let disposed = false;
    const changePending = (delta: number) => setPending((count) => count + delta);
    context.ui.slot({
      append: "prompt.footer.status",
      render: () => <Show when={pending() > 0}><Pending context={context} /></Show>,
    });
    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "session.aside", title: "Ask a side question", group: "Session", palette: true,
            description: "Answer from the session's context, with follow-ups kept outside its history",
            slash: { name: "btw", arguments: true },
            async run(input) {
              const route = context.ui.router.current();
              if (route.type !== "session") {
                context.ui.toast.show({ variant: "warning", message: "Open a session first." });
                return;
              }
              const question = input?.trim() || await context.ui.dialog.prompt({ title: "/btw", placeholder: "Ask anything" });
              if (!question?.trim() || disposed) return;
              const controller = new AbortController();
              requests.add(controller);
              changePending(1);
              try {
                const answer = await generate(context, route.sessionID, question, [], controller.signal);
                if (disposed || controller.signal.aborted) return;
                context.ui.dialog.show(() => <Conversation context={context} sessionID={route.sessionID}
                  initial={{ question, answer }} pending={changePending} requests={requests} />);
                context.ui.dialog.set({ size: "large", centered: true });
              } catch (error) {
                if (!disposed) context.ui.toast.show({ variant: "error", title: "BTW failed", message: String(error) });
              } finally {
                requests.delete(controller);
                changePending(-1);
              }
            },
          }],
        }));
        return null;
      },
    });
    return () => {
      disposed = true;
      for (const request of requests) request.abort();
    };
  },
});
