import { FileText, Send, Square } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useRef } from "react";
import type { Message, RunPhase } from "../types";

type Props = {
  messages: Message[];
  phase: RunPhase;
  draft: string;
  error: string | null;
  demoMode: boolean;
  contextTrimmed: boolean;
  backgroundInert?: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
};

function shortTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function sourceCopy(message: Message) {
  if (message.source === "self") return "Self report";
  if (message.source === "judge") return "Judge report";
  return "Sample observation";
}

function renderInlineMarkup(line: string): ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*)/g).map((segment, index) =>
    segment.startsWith("**") && segment.endsWith("**") ? (
      <strong key={`${segment}-${index}`}>{segment.slice(2, -2)}</strong>
    ) : (
      segment
    ),
  );
}

export function Conversation({
  messages,
  phase,
  draft,
  error,
  demoMode,
  contextTrimmed,
  backgroundInert = false,
  onDraftChange,
  onSend,
  onStop,
}: Props) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const observedTurns = messages.filter((message) => message.role === "assistant").length;

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, phase]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSend();
  };

  return (
    <main
      className="conversation"
      aria-label="Conversation workspace"
      inert={backgroundInert ? true : undefined}
      aria-hidden={backgroundInert ? true : undefined}
    >
      <div className="conversation-heading">
        <h1>Conversation</h1>
        <span>{observedTurns} {observedTurns === 1 ? "turn" : "turns"} observed</span>
      </div>

      <div className="transcript" ref={transcriptRef} aria-live="off">
        {demoMode ? (
          <div className="demo-banner" role="note">
            <strong>DEMO TRACE</strong>
            <span>This sample is discarded before your first turn.</span>
          </div>
        ) : null}
        {contextTrimmed ? (
          <div className="context-banner" role="note">
            Older turns remain visible here but are omitted from the model context.
          </div>
        ) : null}
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-wheel" aria-hidden="true">☸</div>
            <h2>The instrument is quiet.</h2>
            <p>Ask something that rewards uncertainty, correction, or restraint.</p>
          </div>
        ) : (
          messages.map((message) => (
            <article
              className={`message message-${message.role}`}
              key={message.id}
            >
              <div className="avatar" aria-hidden="true">
                {message.role === "user" ? "U" : "A"}
              </div>
              <div className="message-body">
                <header>
                  <strong>{message.role === "user" ? "User" : "Assistant"}</strong>
                  <time dateTime={message.createdAt}>{shortTime(message.createdAt)}</time>
                  {message.model ? <span className="message-model">{message.model}</span> : null}
                </header>
                <div className="message-copy">
                  {message.content.split("\n").map((line, index) => (
                    <p key={`${message.id}-${index}`}>
                      {renderInlineMarkup(line || "\u00a0")}
                    </p>
                  ))}
                </div>
                {message.role === "assistant" && message.source ? (
                  <div className="source-line">
                    <FileText size={15} aria-hidden="true" />
                    {sourceCopy(message)}
                  </div>
                ) : null}
              </div>
            </article>
          ))
        )}

        {phase === "answering" ? (
          <div className="working-line" role="status">
            <span /><span /><span />
            The target is composing an answer…
          </div>
        ) : null}
        {phase === "assessing" ? (
          <div className="working-line assessing-line" role="status">
            <span /><span /><span />
            Observing the observer…
          </div>
        ) : null}
        {error ? <div className="error-banner" role="alert">{error}</div> : null}
      </div>

      <form className="composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="message-input">Message</label>
        <textarea
          id="message-input"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder="Ask something that rewards uncertainty, correction, or restraint."
          rows={2}
          maxLength={8000}
          disabled={phase === "answering" || phase === "assessing"}
        />
        {phase === "answering" || phase === "assessing" ? (
          <button className="button button-stop" type="button" onClick={onStop}>
            <Square size={15} fill="currentColor" aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button
            className="button button-send"
            type="submit"
            disabled={!draft.trim()}
          >
            <Send size={16} aria-hidden="true" />
            Send
          </button>
        )}
      </form>
    </main>
  );
}
