"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./use-koya-chat";

/** Koya's chat window: the conversation, a composer, and an End chat control. */
export function ChatPanel({
  messages,
  busy,
  error,
  onSend,
  onEnd,
  locked,
  intro,
}: {
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onEnd: () => void;
  /** True while a voice call is live: chat and voice can't run at the same time. */
  locked: boolean;
  intro: string;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = () => {
    if (!draft.trim() || busy || locked) return;
    onSend(draft);
    setDraft("");
  };

  return (
    <div className="flex h-[30rem] flex-col overflow-hidden rounded-2xl border border-navy-line bg-surface text-text shadow-[0_24px_48px_-24px_rgba(5,15,40,0.6)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white" aria-hidden>
            K
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Koya</p>
            <p className="text-xs text-muted">{busy ? "Typing…" : "RelayPay support assistant"}</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={onEnd} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted hover:border-danger hover:text-danger">
            End chat
          </button>
        )}
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-background px-4 py-4" aria-live="polite" aria-label="Chat with Koya">
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-surface px-3.5 py-2.5 text-sm leading-6 shadow-sm">{intro}</div>
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-brand px-3.5 py-2.5 text-sm leading-6 text-white">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="max-w-[85%] rounded-2xl rounded-tl-sm bg-surface px-3.5 py-2.5 text-sm leading-6 shadow-sm">
              {m.text || (
                <span className="inline-flex gap-1 py-1" aria-label="Koya is typing">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-muted" />
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-muted [animation-delay:150ms]" />
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-muted [animation-delay:300ms]" />
                </span>
              )}
            </div>
          ),
        )}
        {error && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t border-border bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="koya-chat-input" className="sr-only">
          Message Koya
        </label>
        <textarea
          id="koya-chat-input"
          rows={1}
          value={draft}
          maxLength={2000}
          disabled={locked}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={locked ? "End the voice call to chat" : "Type your question…"}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-md border border-border bg-surface px-3.5 py-2.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-background"
        />
        <button
          type="submit"
          disabled={locked || busy || !draft.trim()}
          aria-label="Send"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-brand text-white hover:bg-brand-hover disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
    </div>
  );
}
