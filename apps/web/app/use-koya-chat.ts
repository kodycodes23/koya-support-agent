"use client";

import { useCallback, useRef, useState } from "react";
import { chatErrorMessage } from "./friendly-errors";

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** Still streaming in. */
  pending?: boolean;
}

/** One `data:` line of the OpenAI-style stream; `koya` rides on the last chunk. */
interface StreamChunk {
  choices?: { delta?: { content?: string } }[];
  koya?: { signInRequested?: boolean };
}

/**
 * Text chat with Koya through /api/chat. A chat is one conversation (one session id) until it is
 * ended; the whole history is sent each time, and Koya's reply streams in as it is written.
 */
export function useKoyaChat() {
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInRequested, setSignInRequested] = useState(false);
  const nextId = useRef(0);
  const abort = useRef<AbortController | null>(null);

  /** Sends the conversation so far (plus `text`, if given) and streams Koya's answer. */
  const run = useCallback(
    async (history: ChatMessage[]) => {
      setBusy(true);
      setError(null);
      const replyId = nextId.current++;
      setMessages([...history, { id: replyId, role: "assistant", text: "", pending: true }]);
      const controller = new AbortController();
      abort.current = controller;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, messages: history.map(({ role, text }) => ({ role, content: text })) }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw Object.assign(new Error(body.error ?? "chat request failed"), { status: res.status });
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let reply = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const data = line.startsWith("data:") ? line.slice(5).trim() : "";
            if (!data || data === "[DONE]") continue;
            const chunk = JSON.parse(data) as StreamChunk;
            const delta = chunk.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              reply += delta;
              setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, text: reply } : m)));
            }
            if (chunk.koya?.signInRequested) setSignInRequested(true);
          }
        }
        setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, text: reply.trim(), pending: false } : m)));
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(chatErrorMessage(e, (e as { status?: number }).status));
        setMessages((prev) => prev.filter((m) => m.id !== replyId));
      } finally {
        setBusy(false);
        abort.current = null;
      }
    },
    [sessionId],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      void run([...messages.filter((m) => !m.pending), { id: nextId.current++, role: "user", text: trimmed }]);
    },
    [busy, messages, run],
  );

  /** The customer signed in mid-chat: Koya welcomes them back and carries on with their question. */
  const continueSignedIn = useCallback(() => {
    setSignInRequested(false);
    void run(messages.filter((m) => !m.pending));
  }, [messages, run]);

  /** Ends this conversation; the next message starts a new one. */
  const end = useCallback(() => {
    abort.current?.abort();
    setMessages([]);
    setError(null);
    setBusy(false);
    setSignInRequested(false);
    setSessionId(crypto.randomUUID());
  }, []);

  return { messages, busy, error, active: messages.length > 0, signInRequested, dismissSignIn: () => setSignInRequested(false), send, continueSignedIn, end };
}
