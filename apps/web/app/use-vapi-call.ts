"use client";

import Vapi from "@vapi-ai/web";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCallIdentityToken } from "./lib/call-identity";
import { typedFieldOf } from "./references";

export type CallStatus = "idle" | "connecting" | "listening" | "speaking" | "ending" | "ended" | "error";

export interface TranscriptLine {
  id: number;
  role: "user" | "assistant";
  text: string;
  final: boolean;
  /** Typed on screen during the call (shown as typed, not transcribed). */
  typed?: boolean;
  /** Text of this line's already-finished chunks (internal, for joining chunks). */
  settled?: string;
}

/** Vapi `message` events of type "transcript". Other message types are ignored. */
interface TranscriptMessage {
  type: "transcript";
  role: "user" | "assistant";
  transcriptType: "partial" | "final";
  transcript: string;
}

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "";
const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? "";

function isTranscript(m: unknown): m is TranscriptMessage {
  const msg = m as Partial<TranscriptMessage> | null;
  return msg?.type === "transcript" && typeof msg.transcript === "string" && (msg.role === "user" || msg.role === "assistant");
}

function errorText(e: unknown): string {
  const err = e as { error?: { message?: string; msg?: string } | string; message?: string; errorMsg?: string } | null;
  const raw =
    (typeof err?.error === "string" ? err.error : err?.error?.message ?? err?.error?.msg) ?? err?.errorMsg ?? err?.message ?? "";
  if (/permission|NotAllowed|microphone/i.test(raw)) {
    return "Microphone access was blocked. Allow the microphone for this site and try again.";
  }
  return raw ? `The call could not continue: ${raw}` : "The call could not continue. Please try again.";
}

/**
 * Owns the Vapi web client: call lifecycle, live transcript, mute, and a
 * volume level (0–1) for visualisation. Volume is kept in a ref, not state,
 * so audio updates never re-render the page.
 */
/** Koya's opening line; personalised when we know who is signed in. */
export function greetingFor(firstName?: string | null): string {
  const hello = firstName ? `Hello ${firstName}, you're` : "Hi, you're";
  return `${hello} through to RelayPay support. I'm Koya. How can I help you today?`;
}

/** `firstName` is the signed-in customer's first name (from the server), used in the greeting. */
export function useVapiCall(firstName?: string | null) {
  const vapiRef = useRef<Vapi | null>(null);
  const nextId = useRef(0);
  const volume = useRef(0); // Koya's voice (assistant audio)
  const micVolume = useRef(0); // the caller's microphone
  const [status, setStatus] = useState<CallStatus>("idle");
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Vapi's id for the live call (used to ask the server whether Koya wants the caller to sign in). */
  const [callId, setCallId] = useState<string | null>(null);
  const configured = Boolean(PUBLIC_KEY && ASSISTANT_ID);

  useEffect(() => {
    if (!configured) return;
    const vapi = new Vapi(PUBLIC_KEY);
    vapiRef.current = vapi;

    vapi.on("call-start", () => {
      setStatus("listening");
      setError(null);
    });
    vapi.on("call-end", () => {
      setStatus((s) => (s === "error" ? s : "ended"));
      setMuted(false);
      setCallId(null);
      volume.current = 0;
      micVolume.current = 0;
    });
    vapi.on("speech-start", () => setStatus("speaking"));
    vapi.on("speech-end", () => setStatus((s) => (s === "speaking" ? "listening" : s)));
    vapi.on("volume-level", (v: number) => {
      volume.current = v;
    });
    vapi.on("local-volume-level", (v: number) => {
      micVolume.current = v;
    });
    vapi.on("error", (e: unknown) => {
      setError(errorText(e));
      setStatus("error");
    });
    vapi.on("message", (m: unknown) => {
      if (!isTranscript(m)) return;
      const final = m.transcriptType === "final";
      setLines((prev) => {
        const last = prev.at(-1);
        if (last && last.role === m.role) {
          // Vapi sends speech in short chunks. Keep one line per speaker turn: a partial replaces
          // the in-progress chunk, and a new chunk after a settled one is appended to the same line.
          const settled = last.final ? last.text : (last.settled ?? "");
          const text = settled ? `${settled} ${m.transcript}` : m.transcript;
          return [...prev.slice(0, -1), { ...last, text, final, settled: final ? text : settled }];
        }
        return [...prev, { id: nextId.current++, role: m.role, text: m.transcript, final, settled: final ? m.transcript : "" }];
      });
    });

    return () => {
      vapi.removeAllListeners();
      void vapi.stop();
      vapiRef.current = null;
    };
  }, [configured]);

  const inCall = status === "connecting" || status === "listening" || status === "speaking";

  const start = useCallback(async () => {
    const vapi = vapiRef.current;
    if (!vapi) return;
    setLines([]);
    setError(null);
    setStatus("connecting");
    try {
      // Signed-in customers get a short-lived signed token so Koya knows who is calling.
      const identityToken = await getCallIdentityToken().catch(() => null);
      const call = await vapi.start(ASSISTANT_ID, {
        firstMessage: greetingFor(firstName),
        ...(identityToken ? { metadata: { identityToken } } : {}),
      });
      if (!call) {
        setStatus("error");
        setError("The call could not be started. Please try again.");
      } else {
        setCallId(call.id ?? null);
      }
    } catch (e) {
      setStatus("error");
      setError(errorText(e));
    }
  }, [firstName]);

  const stop = useCallback(async () => {
    setStatus("ending");
    await vapiRef.current?.stop();
  }, []);

  const toggle = useCallback(() => (inCall ? stop() : start()), [inCall, start, stop]);

  /**
   * The caller signed in partway through the call: hand Koya their signed token as a system
   * message and let it reply straight away ("Welcome back, …"). The server verifies the token.
   */
  const sendIdentity = useCallback((token: string) => {
    vapiRef.current?.send({ type: "add-message", message: { role: "system", content: `[koya-identity:${token}]` }, triggerResponseEnabled: true });
  }, []);

  /**
   * Speech-to-text often gets names (and emails) wrong. The caller can type them instead: the text
   * goes into the call as their own message, labelled with what it is, and Koya replies to it.
   */
  const sendTyped = useCallback((text: string) => {
    const value = text.trim();
    if (!value || !vapiRef.current) return;
    vapiRef.current.send({ type: "add-message", message: { role: "user", content: `[typed ${typedFieldOf(value)}] ${value}` }, triggerResponseEnabled: true });
    setLines((prev) => [...prev, { id: nextId.current++, role: "user", text: value, final: true, typed: true }]);
  }, []);

  const toggleMute = useCallback(() => {
    const vapi = vapiRef.current;
    if (!vapi) return;
    vapi.setMuted(!muted);
    setMuted(!muted);
  }, [muted]);

  return { configured, status, inCall, muted, lines, error, volume, micVolume, callId, start, stop, toggle, toggleMute, sendIdentity, sendTyped };
}
