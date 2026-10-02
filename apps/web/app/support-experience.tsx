"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CallbackForm } from "./callback-form";
import { ChatPanel } from "./chat-panel";
import { getCallIdentityToken } from "./lib/call-identity";
import { SignInModal } from "./sign-in-modal";
import { TypeInstead } from "./type-instead";
import { useKoyaChat } from "./use-koya-chat";
import { IdleTimeout } from "./idle-timeout";
import { ProfileMenu } from "./profile-menu";
import { writtenReferences } from "./references";
import { useVapiCall, type CallStatus } from "./use-vapi-call";
import { VoiceOrb } from "./voice-orb";

const STATUS_LABEL: Record<CallStatus, string> = {
  idle: "Ready when you are",
  connecting: "Connecting…",
  listening: "Listening",
  speaking: "Koya is speaking",
  ending: "Ending call…",
  ended: "Call ended",
  error: "Something went wrong",
};

/**
 * Development-only orb preview: /?orb=speaking or /?orb=listening simulates a call with a
 * synthetic voice level, so the animation can be checked without placing a call.
 */
function useOrbPreview(volume: { current: number }, micVolume: { current: number }): CallStatus | null {
  const [preview, setPreview] = useState<CallStatus | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const mode = new URLSearchParams(window.location.search).get("orb");
    if (mode !== "speaking" && mode !== "listening") return;
    const show = window.setTimeout(() => setPreview(mode), 0);
    const target = mode === "speaking" ? volume : micVolume;
    const started = performance.now();
    const id = window.setInterval(() => {
      const t = (performance.now() - started) / 1000;
      // Speech-like bursts: syllables inside phrases, with short pauses between phrases.
      const phrase = Math.max(0, Math.sin(t * 1.3));
      target.current = phrase * (0.35 + 0.5 * Math.abs(Math.sin(t * 9.5)));
    }, 50);
    return () => {
      window.clearTimeout(show);
      window.clearInterval(id);
    };
  }, [volume, micVolume]);
  return preview;
}

/** Section label in thin brackets, e.g. [ What Koya handles ]. */
function Eyebrow({ children, onNavy = false }: { children: ReactNode; onNavy?: boolean }) {
  return (
    <p className={`inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] ${onNavy ? "text-accent-on-navy" : "text-accent"}`}>
      <span aria-hidden className="opacity-60">[</span>
      {children}
      <span aria-hidden className="opacity-60">]</span>
    </p>
  );
}

/** Thin corner marks framing the orb. */
function CornerFrame({ children, live }: { children: ReactNode; live: boolean }) {
  const corner = "pointer-events-none absolute h-5 w-5 border-accent-on-navy/50";
  return (
    <div className="relative p-6 sm:p-8">
      <span aria-hidden className={`${corner} left-0 top-0 border-l border-t`} />
      <span aria-hidden className={`${corner} right-0 top-0 border-r border-t`} />
      <span aria-hidden className={`${corner} bottom-0 left-0 border-b border-l`} />
      <span aria-hidden className={`${corner} bottom-0 right-0 border-b border-r`} />
      {live && (
        <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-on-navy/40 bg-navy px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-on-navy">
          Live
        </span>
      )}
      {children}
    </div>
  );
}

type IconName = "fees" | "transfer" | "invoice" | "shield";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    fees: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 3 5.6 1.5 5.6 4.3 0 1.3-1.2 2.1-2.8 2.1-1.3 0-2.4-.6-2.9-1.5M12 6.3v1.5M12 16.9v1.1" />
      </>
    ),
    transfer: <path d="M4 8h13m0 0-3.5-3.5M17 8l-3.5 3.5M20 16H7m0 0 3.5-3.5M7 16l3.5 3.5" />,
    invoice: (
      <>
        <path d="M6.5 3.5h8l3 3v14h-11z" />
        <path d="M14.5 3.5v3h3M9.5 11h5M9.5 14h5M9.5 17h3" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3.5 5.5 6v5.2c0 4.1 2.8 7.4 6.5 8.8 3.7-1.4 6.5-4.7 6.5-8.8V6z" />
        <path d="m9.3 12 1.9 1.9 3.6-3.8" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[name]}
    </svg>
  );
}

const TOPICS: { icon: IconName; title: string; body: string }[] = [
  { icon: "fees", title: "Fees and pricing", body: "How fees depend on the corridor, currency and payment method, and where you see them before you confirm." },
  { icon: "transfer", title: "Transfers and payouts", body: "The current status of a transaction or contractor payout, straight from its reference number." },
  { icon: "invoice", title: "Multi-currency invoicing", body: "Creating invoices in supported currencies, due dates, and what affects when you get paid." },
  { icon: "shield", title: "Account and compliance", body: "Verification, restrictions, disputes and refunds are passed to a RelayPay specialist." },
];

const STEPS = [
  { n: "01", title: "Speak or type", body: "Describe what you need in your own words, the way you would to a colleague." },
  { n: "02", title: "Koya checks", body: "It looks up RelayPay's approved help content, or, once you've signed in, your own payments." },
  { n: "03", title: "Get an outcome", body: "A clear answer, a support ticket, or a callback from a specialist." },
];

/** Shown when the page has no customer-specific suggestions. */
const GENERAL_SUGGESTIONS = ["What fees does RelayPay charge?", "How long do international payments take?", "Why would my account be under review?"];

export interface SignedInCaller {
  firstName: string;
  fullName: string;
  company: string;
  email: string;
  /** "Try asking" prompts built from this customer's own payments. */
  suggestions: string[];
}

export function SupportExperience({
  signedIn = null,
  idleTimeoutSeconds,
}: {
  signedIn?: SignedInCaller | null;
  idleTimeoutSeconds?: number;
}) {
  const call = useVapiCall(signedIn?.firstName);
  const chat = useKoyaChat();
  const router = useRouter();
  const transcriptEnd = useRef<HTMLDivElement | null>(null);
  const preview = useOrbPreview(call.volume, call.micVolume);
  // Voice or chat, never both: the mode can only change while neither is in use.
  const [mode, setMode] = useState<"voice" | "chat">("voice");
  const modeLocked = call.inCall || call.status === "connecting" || chat.active;
  const [signInOpen, setSignInOpen] = useState(false);
  const askedToSignIn = useRef<string | null>(null);

  // Guest on a voice call: open the sign-in window as soon as Koya asks for it.
  useEffect(() => {
    if (signedIn || !call.inCall || !call.callId) return;
    const callId = call.callId;
    const id = window.setInterval(async () => {
      if (askedToSignIn.current === callId) return;
      const res = await fetch(`/api/koya/sign-in-request?callId=${encodeURIComponent(callId)}`, { cache: "no-store" }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { requested?: boolean } | null;
      if (body?.requested) {
        askedToSignIn.current = callId;
        setSignInOpen(true);
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [signedIn, call.inCall, call.callId]);

  // Guest in the chat: Koya's reply says when to open the sign-in window.
  const showSignIn = signInOpen || (chat.signInRequested && !signedIn);

  // Signed in from the window: the same call or chat carries on as this customer.
  const handleSignedIn = useCallback(async () => {
    setSignInOpen(false);
    if (call.inCall) {
      const token = await getCallIdentityToken().catch(() => null);
      if (token) call.sendIdentity(token);
    } else if (chat.active) {
      chat.continueSignedIn();
    }
    router.refresh(); // header, suggestions and callback form now reflect the signed-in customer
  }, [call, chat, router]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [call.lines]);

  const inCall = preview ? true : call.inCall;
  const status = preview ?? call.status;
  const showTranscript = call.inCall || call.lines.length > 0;
  // Koya just asked for a name, email or reference: highlight the type-it-instead box.
  const lastKoyaLine = [...call.lines].reverse().find((l) => l.role === "assistant")?.text ?? "";
  const koyaAskedForDetails = /\b(your name|full name|email|spell|reference|type it)\b/i.test(lastKoyaLine);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Signed-in only; a live call counts as activity so nobody is signed out mid-call. */}
      {signedIn && idleTimeoutSeconds && <IdleTimeout timeoutSeconds={idleTimeoutSeconds} busy={call.inCall || chat.busy} />}
      <SignInModal
        open={showSignIn}
        onClose={() => {
          setSignInOpen(false);
          chat.dismissSignIn();
        }}
        onSignedIn={() => void handleSignedIn()}
      />
      {/* Top bar: logo at the top-left, two restrained actions on the right. */}
      {/* Full-width bar, so the logo sits at the top-left of the interface, per the brand direction. */}
      <header className="border-b border-border bg-surface">
        <nav className="flex w-full items-center justify-between gap-6 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="RelayPay home">
            <Image src="/relaypay-mark.svg" alt="" width={30} height={30} priority />
            <Image src="/relaypay-wordmark.svg" alt="RelayPay" width={104} height={14} priority />
            <span className="ml-1 hidden border-l border-border pl-3 text-sm text-muted sm:inline">Support</span>
          </Link>
          <div className="flex items-center gap-2">
            {signedIn && (
              <Link href="/dashboard" className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted hover:text-text md:inline-block">
                Dashboard
              </Link>
            )}
            <a href="#help" className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted hover:text-text lg:inline-block">
              What Koya handles
            </a>
            {signedIn ? (
              <a href="#callback" className="hidden rounded-md border border-border px-3.5 py-2 text-sm font-medium text-text hover:bg-background sm:inline-block">
                Request a callback
              </a>
            ) : (
              <Link href="/signin" className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-text hover:bg-background">
                Sign in
              </Link>
            )}
            {mode === "voice" && (
              <button
                type="button"
                onClick={call.toggle}
                disabled={!call.configured || call.status === "ending" || chat.active}
                className={`hidden rounded-md px-3.5 py-2 text-sm font-medium disabled:opacity-50 sm:inline-block ${
                  call.inCall ? "border border-danger text-danger hover:bg-danger-soft" : "bg-brand text-white hover:bg-brand-hover"
                }`}
              >
                {call.inCall ? "End call" : "Talk to Koya"}
              </button>
            )}
            {signedIn && (
              <ProfileMenu
                fullName={signedIn.fullName}
                company={signedIn.company}
                email={signedIn.email}
                onBeforeLogout={() => void call.stop()}
              />
            )}
          </div>
        </nav>
      </header>

      <main className="flex-1 px-4 sm:px-6">
        {/* Hero: deep-blue panel with a flat dot grid. */}
        <section className="dot-grid mx-auto mt-6 max-w-6xl overflow-hidden rounded-2xl bg-navy text-on-navy">
          <div className="grid items-center gap-10 px-6 py-12 sm:px-10 lg:grid-cols-[1.05fr_1fr] lg:py-16">
            <div>
              <Eyebrow onNavy>RelayPay support · voice or chat</Eyebrow>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
                Talk to <span className="text-accent-on-navy">Koya</span>,
                <br />
                your payments support assistant
              </h1>
              <p className="mt-5 max-w-lg text-base leading-7 text-on-navy-muted">
                Speak or type. Koya answers from RelayPay&apos;s approved help content, checks payments for signed-in customers, and
                brings in a specialist when your case needs one.
              </p>
              {signedIn ? (
                <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-navy-line px-3 py-1.5 text-sm text-on-navy">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent-on-navy" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 3.5 5.5 6v5.2c0 4.1 2.8 7.4 6.5 8.8 3.7-1.4 6.5-4.7 6.5-8.8V6z" />
                    <path d="m9.3 12 1.9 1.9 3.6-3.8" />
                  </svg>
                  Signed in as {signedIn.firstName} · {signedIn.company}. Koya will know it&apos;s you.
                </p>
              ) : (
                <p className="mt-5 text-sm text-on-navy-muted">
                  No account needed for general questions. Already a customer?{" "}
                  <Link href="/signin" className="text-accent-on-navy hover:underline">
                    Sign in
                  </Link>{" "}
                  and Koya can help with your payments too.
                </p>
              )}

              <div className="mt-8">
                <div role="tablist" aria-label="How to talk to Koya" className="inline-flex rounded-lg border border-navy-line p-1">
                  {(["voice", "chat"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={mode === m}
                      disabled={modeLocked && mode !== m}
                      onClick={() => setMode(m)}
                      className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        mode === m ? "bg-white text-navy" : "text-on-navy-muted hover:text-on-navy"
                      }`}
                    >
                      {m === "voice" ? "Voice" : "Chat"}
                    </button>
                  ))}
                </div>
                {modeLocked && (
                  <p className="mt-2 text-xs text-on-navy-muted">
                    {mode === "voice" ? "End the call to switch to chat." : "End the chat to switch to voice."}
                  </p>
                )}
              </div>

              {mode === "chat" ? (
                <p className="mt-6 max-w-md text-sm leading-6 text-on-navy-muted">
                  Type your question in the chat window. Koya replies in a few seconds; end the chat when you&apos;re done.
                </p>
              ) : call.configured ? (
                <>
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={call.toggle}
                      disabled={call.status === "ending"}
                      className={`inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-semibold disabled:opacity-50 ${
                        call.inCall ? "border border-white/30 text-white hover:bg-white/10" : "bg-white text-navy hover:bg-accent-soft"
                      }`}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                        <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
                      </svg>
                      {call.inCall ? "End call" : call.status === "ended" || call.status === "error" ? "Speak with Koya again" : "Speak with Koya"}
                    </button>
                    {call.inCall ? (
                      <button
                        type="button"
                        onClick={call.toggleMute}
                        disabled={call.status === "connecting"}
                        className="rounded-md border border-navy-line px-5 py-3 text-sm font-medium text-on-navy hover:bg-white/10 disabled:opacity-50"
                      >
                        {call.muted ? "Unmute" : "Mute"}
                      </button>
                    ) : signedIn ? (
                      <a href="#callback" className="rounded-md border border-navy-line px-5 py-3 text-sm font-medium text-on-navy hover:bg-white/10">
                        Request a callback
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-4 text-sm text-on-navy-muted" role="status" aria-live="polite">
                    <span
                      aria-hidden
                      className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${
                        call.status === "error" ? "bg-danger" : call.inCall ? "bg-accent-on-navy" : "bg-on-navy-muted/50"
                      } ${call.status === "connecting" || call.status === "speaking" ? "pulse-dot" : ""}`}
                    />
                    {STATUS_LABEL[call.status]}
                    {call.muted && call.inCall ? " · microphone muted" : ""}
                  </p>
                  {call.error && (
                    <p className="mt-3 max-w-md rounded-md bg-danger-soft px-4 py-2 text-sm text-danger" role="alert">
                      {call.error}
                    </p>
                  )}
                  {/* `inCall` also covers the dev-only orb preview, so the box can be checked without a call. */}
                  {inCall && call.status !== "connecting" && (
                    <TypeInstead onSend={call.sendTyped} prompted={koyaAskedForDetails} />
                  )}
                </>
              ) : (
                <p className="mt-8 max-w-md text-sm text-on-navy-muted">
                  Voice is not configured yet. Set <code className="text-on-navy">NEXT_PUBLIC_VAPI_PUBLIC_KEY</code> and{" "}
                  <code className="text-on-navy">NEXT_PUBLIC_VAPI_ASSISTANT_ID</code> in <code className="text-on-navy">apps/web/.env.local</code>.
                </p>
              )}

              <div className="mt-8">
                <p className="text-xs uppercase tracking-[0.14em] text-on-navy-muted/80">Try asking</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {(signedIn?.suggestions.length ? signedIn.suggestions : GENERAL_SUGGESTIONS).map((q) => (
                    <li key={q} className="rounded-full border border-navy-line px-3 py-1.5 text-sm text-on-navy/90">
                      &ldquo;{q}&rdquo;
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mx-auto w-full max-w-md">
              {mode === "chat" ? (
                <ChatPanel
                  messages={chat.messages}
                  busy={chat.busy}
                  error={chat.error}
                  onSend={chat.send}
                  onEnd={chat.end}
                  locked={call.inCall}
                  intro={
                    signedIn
                      ? `Hello ${signedIn.firstName}, I'm Koya. How can I help you today?`
                      : "Hi, I'm Koya, RelayPay's support assistant. Ask me anything about RelayPay."
                  }
                />
              ) : (
                <CornerFrame live={inCall}>
                  <VoiceOrb
                    tone="dark"
                    status={status}
                    inCall={inCall}
                    volume={call.volume}
                    micVolume={call.micVolume}
                    onToggle={call.toggle}
                    disabled={!call.configured || call.status === "ending" || chat.active}
                  />
                </CornerFrame>
              )}
            </div>
          </div>

          {/* Key facts strip, like a spec line under the hero. */}
          <ul className="grid border-t border-navy-line text-sm text-on-navy-muted sm:grid-cols-3">
            {[
              "Answers only from approved RelayPay help content",
              "Account help only for signed-in customers",
              "Specialist handover for account and compliance issues",
            ].map((item, i) => (
              <li key={item} className={`flex items-center gap-3 px-6 py-4 sm:px-10 ${i > 0 ? "border-t border-navy-line sm:border-l sm:border-t-0" : ""}`}>
                <span className="font-mono text-xs text-accent-on-navy">0{i + 1}</span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        {mode === "voice" && showTranscript && (
          <section className="mx-auto mt-6 max-w-6xl rounded-2xl border border-border bg-surface" aria-label="Live transcript">
            <div className="flex items-center justify-between border-b border-border px-6 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Live transcript</p>
              {call.inCall && <span className="text-xs text-accent">{STATUS_LABEL[call.status]}</span>}
            </div>
            <div className="max-h-80 overflow-y-auto px-6 py-4" aria-live="polite">
              {call.lines.length === 0 ? (
                <p className="text-sm text-muted">Say hello to get started.</p>
              ) : (
                <dl className="space-y-3">
                  {call.lines.map((line) => (
                    <div key={line.id} className="grid grid-cols-[3.5rem_1fr] gap-3">
                      <dt className={`pt-0.5 text-xs font-semibold uppercase tracking-wide ${line.role === "assistant" ? "text-accent" : "text-muted"}`}>
                        {line.role === "assistant" ? "Koya" : "You"}
                      </dt>
                      <dd className={`text-sm leading-6 ${line.final ? "text-text" : "text-muted"}`}>
                        {line.role === "assistant" ? writtenReferences(line.text) : line.text}
                        {line.typed && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">typed</span>}
                      </dd>
                    </div>
                  ))}
                  <div ref={transcriptEnd} />
                </dl>
              )}
            </div>
          </section>
        )}

        {/* What Koya handles */}
        <section id="help" className="mx-auto max-w-6xl scroll-mt-6 pt-20">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <Eyebrow>What Koya handles</Eyebrow>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-text sm:text-3xl">First-line support, by voice or chat</h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-muted">
              For anything that needs a person, Koya collects your details and hands over to the RelayPay team.
            </p>
          </div>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TOPICS.map((t) => (
              <li key={t.title} className="group relative rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent/50">
                <span aria-hidden className="absolute right-4 top-4 h-3 w-3 border-r border-t border-border transition-colors group-hover:border-accent" />
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon name={t.icon} />
                </span>
                <h3 className="mt-4 text-base font-semibold text-text">{t.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{t.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-6xl pt-20">
          <Eyebrow>How it works</Eyebrow>
          <ol className="mt-6 grid overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.n} className={`p-6 ${i > 0 ? "border-t border-border sm:border-l sm:border-t-0" : ""}`}>
                <span className="font-mono text-sm text-accent">{s.n}</span>
                <h3 className="mt-3 text-base font-semibold text-text">{s.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Callback request (customers; guests ask Koya, which can book the onboarding team) */}
        {signedIn ? (
        <section id="callback" className="mx-auto max-w-6xl scroll-mt-6 py-20">
          <div className="rounded-2xl border border-border bg-surface px-6 py-12 text-center sm:px-10">
            <Eyebrow>Prefer a person?</Eyebrow>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-text sm:text-3xl">Request a callback</h2>
            <p className="mx-auto mt-3 max-w-lg text-base leading-7 text-muted">
              Leave your details and a RelayPay specialist will call you back. Please don&apos;t include passwords or full account numbers.
            </p>
            <div className="mt-8">
              <CallbackForm />
            </div>
          </div>
        </section>
        ) : (
          <div className="pb-20" />
        )}
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <Image src="/relaypay-mark.svg" alt="" width={22} height={22} />
            <span>© {new Date().getFullYear()} RelayPay. Calls and chats are logged to improve support.</span>
          </div>
          <span>Koya never asks for passwords or full account numbers.</span>
        </div>
      </footer>
    </div>
  );
}
