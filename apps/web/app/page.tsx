import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { db } from "./lib/db";
import { getSession } from "./lib/session";

export const metadata: Metadata = {
  title: "Koya · RelayPay support assistant",
  description: "Ask Koya, RelayPay's support assistant, about payments, invoices, payouts and your account, by voice or chat.",
};

interface KbChunk {
  section: string;
  content: string;
  summary: string;
  source_title: string;
  position: number;
}

/** Feature and FAQ entries straight from the knowledge base Koya answers from. Empty if unavailable. */
async function knowledgeBase(): Promise<{ features: KbChunk[]; faqs: KbChunk[] }> {
  try {
    const { data } = await db().from("kb_chunks").select("section, content, summary, source_title, position").order("position");
    const rows = (data ?? []) as KbChunk[];
    return {
      features: rows.filter((r) => r.source_title.endsWith("Product Features Overview") && r.section !== "Product Features Overview" && r.section !== "Feature Availability And Limitations"),
      faqs: rows.filter((r) => r.source_title.endsWith("Frequently Asked Questions")),
    };
  } catch {
    return { features: [], faqs: [] };
  }
}

/** "How Do I Create A RelayPay Account?" → "How do I create a RelayPay account?" (keeps names and "I"). */
const sentenceCase = (s: string) =>
  s
    .split(" ")
    .map((w, i) => (i === 0 || /^RelayPay/.test(w) || /^I\b/.test(w) ? w : w.toLowerCase()))
    .join(" ");
const firstSentences = (text: string, n = 2) => (text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [text]).slice(0, n).join(" ").trim();

function Eyebrow({ children, onNavy = false }: { children: ReactNode; onNavy?: boolean }) {
  return (
    <p className={`inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] ${onNavy ? "text-accent-on-navy" : "text-accent"}`}>
      <span aria-hidden className="opacity-60">[</span>
      {children}
      <span aria-hidden className="opacity-60">]</span>
    </p>
  );
}

function FeatureIcon({ index }: { index: number }) {
  const paths: ReactNode[] = [
    <path key="t" d="M4 8h13m0 0-3.5-3.5M17 8l-3.5 3.5M20 16H7m0 0 3.5-3.5M7 16l3.5 3.5" />,
    <g key="i">
      <path d="M6.5 3.5h8l3 3v14h-11z" />
      <path d="M14.5 3.5v3h3M9.5 11h5M9.5 14h5M9.5 17h3" />
    </g>,
    <g key="p">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8M16 7.5h5M18.5 5v5" />
    </g>,
    <g key="r">
      <path d="M4 19.5h16M6.5 16V11M11 16V6.5M15.5 16v-6M20 16V8.5" />
    </g>,
    <g key="a">
      <path d="M12 3.5 5.5 6v5.2c0 4.1 2.8 7.4 6.5 8.8 3.7-1.4 6.5-4.7 6.5-8.8V6z" />
      <path d="m9.3 12 1.9 1.9 3.6-3.8" />
    </g>,
  ];
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[index % paths.length]}
    </svg>
  );
}

function FlowLines() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 600 520" preserveAspectRatio="none" fill="none" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => {
        const x = 260 + i * 46;
        return (
          <path
            key={i}
            d={`M${x - 110} 540 C ${x - 50} 400, ${x + 60} 320, ${x + 10} 200 S ${x + 80} 40, ${x + 200} -20`}
            stroke="#5cc6dc"
            strokeOpacity={0.08 + i * 0.03}
            strokeWidth="1.4"
          />
        );
      })}
    </svg>
  );
}

const STEPS = [
  { n: "01", title: "Speak or type", body: "Open Koya and choose voice or chat. Ask in your own words; no menus or forms." },
  { n: "02", title: "Koya answers from approved knowledge", body: "Every answer comes from RelayPay's knowledge base. If it isn't there, Koya says so instead of guessing." },
  { n: "03", title: "Sign in for your own account", body: "Customers sign in and Koya checks their payments and payouts, raises tickets and books specialist callbacks." },
];

const GUEST = [
  "What RelayPay does and who it's for",
  "Fees, exchange rates and payment timelines",
  "Verification, account reviews and how support works",
  "Opening an account: Koya books a call with the onboarding team",
];
const CUSTOMER = [
  "The status of a transaction or payout, by its reference",
  "Your plan, account status and verification status",
  "Support tickets for problems that need follow-up",
  "A specialist callback for disputes, refunds or restrictions",
];

const LIMITS = [
  { title: "No balances on calls", body: "For security, Koya never reads out balances. They're on your dashboard." },
  { title: "No money movement", body: "Koya can't send, cancel or change payments. You stay in control from your dashboard." },
  { title: "Your account needs a sign-in", body: "Guests get general help only. Account details are never shared with anyone who isn't signed in as you." },
  { title: "Logged for quality", body: "Conversations are recorded so the support team can review them and pick up any follow-up." },
];

export default async function HomePage() {
  const [session, kb] = await Promise.all([getSession(), knowledgeBase()]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface">
        <nav className="flex w-full items-center justify-between gap-6 px-4 py-3 sm:px-6 lg:px-8" aria-label="Main">
          <Link href="/" className="flex items-center gap-2.5" aria-label="RelayPay home">
            <Image src="/relaypay-mark.svg" alt="" width={30} height={30} priority />
            <Image src="/relaypay-wordmark.svg" alt="RelayPay" width={104} height={14} priority />
            <span className="ml-1 hidden border-l border-border pl-3 text-sm text-muted sm:inline">Koya</span>
          </Link>
          <div className="flex items-center gap-2">
            <a href="#help" className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted hover:text-text md:inline-block">
              What Koya does
            </a>
            <a href="#knowledge" className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted hover:text-text md:inline-block">
              Knowledge base
            </a>
            {session ? (
              <Link href="/dashboard" className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-text hover:bg-background">
                Dashboard
              </Link>
            ) : (
              <Link href="/signin" className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-text hover:bg-background">
                Sign in as user
              </Link>
            )}
            <Link href="/support" className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-hover">
              Talk to Koya
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1 px-4 sm:px-6">
        {/* Hero */}
        <section className="dot-grid relative mx-auto mt-6 max-w-6xl overflow-hidden rounded-2xl bg-navy text-on-navy">
          <FlowLines />
          <div className="relative grid items-center gap-10 px-6 py-14 sm:px-10 lg:grid-cols-[1.1fr_1fr] lg:py-20">
            <div>
              <Eyebrow onNavy>RelayPay support assistant</Eyebrow>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
                Meet <span className="text-accent-on-navy">Koya</span>.
                <br />
                Answers about RelayPay, any time.
              </h1>
              <p className="mt-5 max-w-lg text-base leading-7 text-on-navy-muted">
                Koya is RelayPay&apos;s first-line support assistant. Ask about cross-border payments, multi-currency invoices and
                contractor payouts by voice or chat. It answers from RelayPay&apos;s approved knowledge and brings in the team when
                you need a person.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/support" className="inline-flex items-center gap-2 rounded-md bg-white px-5 py-3 text-sm font-semibold text-navy hover:bg-accent-soft">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
                  </svg>
                  Talk to Koya
                </Link>
                {session ? (
                  <Link href="/dashboard" className="rounded-md border border-navy-line px-5 py-3 text-sm font-medium text-on-navy hover:bg-white/10">
                    Go to your dashboard
                  </Link>
                ) : (
                  <Link href="/signin" className="rounded-md border border-navy-line px-5 py-3 text-sm font-medium text-on-navy hover:bg-white/10">
                    Sign in as user
                  </Link>
                )}
              </div>
              <p className="mt-5 text-sm text-on-navy-muted">Voice or chat · No account needed for general questions</p>
            </div>

            {/* A real answer Koya gave in testing. */}
            <figure className="mx-auto w-full max-w-md rounded-2xl border border-navy-line bg-white/[0.04] p-5 backdrop-blur-sm">
              <figcaption className="flex items-center justify-between text-xs uppercase tracking-[0.14em] text-on-navy-muted">
                <span>Chat with Koya</span>
                <span className="inline-flex items-center gap-1.5 text-accent-on-navy">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent-on-navy" aria-hidden />
                  Online
                </span>
              </figcaption>
              <div className="mt-4 space-y-3 text-sm leading-6">
                <p className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-white px-3.5 py-2.5 text-navy">What does RelayPay charge for international payments?</p>
                <p className="max-w-[90%] rounded-2xl rounded-tl-sm border border-navy-line bg-navy/60 px-3.5 py-2.5 text-on-navy">
                  Fees vary based on the payment type, where the money is going and how you&apos;re sending it, but the exact fees are always
                  shown to you before you confirm the payment.
                </p>
                <p className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-white px-3.5 py-2.5 text-navy">Where is my payout PAY-7001?</p>
                <p className="max-w-[90%] rounded-2xl rounded-tl-sm border border-navy-line bg-navy/60 px-3.5 py-2.5 text-on-navy">
                  I can help with that once you&apos;re signed in. Do you already have a RelayPay account?
                </p>
              </div>
            </figure>
          </div>
          <ul className="relative grid border-t border-navy-line text-sm text-on-navy-muted sm:grid-cols-3">
            {["Answers only from approved RelayPay knowledge", "Account help only after you sign in", "A specialist when your case needs one"].map((item, i) => (
              <li key={item} className={`flex items-center gap-3 px-6 py-4 sm:px-10 ${i > 0 ? "border-t border-navy-line sm:border-l sm:border-t-0" : ""}`}>
                <span className="font-mono text-xs text-accent-on-navy">0{i + 1}</span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* What Koya can help with: RelayPay's products, from the knowledge base */}
        {kb.features.length > 0 && (
          <section id="help" className="mx-auto max-w-6xl scroll-mt-6 pt-20">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <Eyebrow>What Koya can help with</Eyebrow>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-text sm:text-3xl">Everything RelayPay does, explained</h2>
              </div>
              <p className="max-w-sm text-sm leading-6 text-muted">From RelayPay&apos;s knowledge base, the same source Koya answers from.</p>
            </div>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {kb.features.map((f, i) => (
                <li key={f.section} className="group relative rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent/50">
                  <span aria-hidden className="absolute right-4 top-4 h-3 w-3 border-r border-t border-border transition-colors group-hover:border-accent" />
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <FeatureIcon index={i} />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-text">{sentenceCase(f.section)}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{firstSentences(f.summary || f.content)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

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

        {/* Guests vs customers */}
        <section className="mx-auto grid max-w-6xl gap-4 pt-20 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
            <Eyebrow>Without signing in</Eyebrow>
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-text">Ask Koya anything about RelayPay</h2>
            <ul className="mt-5 space-y-3">
              {GUEST.map((g) => (
                <li key={g} className="flex gap-3 text-sm leading-6 text-text">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {g}
                </li>
              ))}
            </ul>
            <Link href="/support" className="mt-6 inline-flex rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover">
              Talk to Koya
            </Link>
          </div>
          <div className="rounded-2xl bg-navy p-6 text-on-navy sm:p-8">
            <Eyebrow onNavy>RelayPay customers</Eyebrow>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">Help with your own account</h2>
            <ul className="mt-5 space-y-3">
              {CUSTOMER.map((c) => (
                <li key={c} className="flex gap-3 text-sm leading-6">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-on-navy" />
                  {c}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm text-on-navy-muted">Already talking to Koya as a guest? It opens a sign-in window and carries on where you left off.</p>
            <Link href={session ? "/support" : "/signin"} className="mt-6 inline-flex rounded-md bg-white px-4 py-2.5 text-sm font-semibold text-navy hover:bg-accent-soft">
              {session ? "Talk to Koya" : "Sign in as user"}
            </Link>
          </div>
        </section>

        {/* Knowledge base FAQs */}
        {kb.faqs.length > 0 && (
          <section id="knowledge" className="mx-auto max-w-6xl scroll-mt-6 pt-20">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <Eyebrow>Knowledge base</Eyebrow>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-text sm:text-3xl">Frequently asked questions</h2>
              </div>
              <p className="max-w-sm text-sm leading-6 text-muted">Koya answers these and more. Can&apos;t find yours? Ask Koya directly.</p>
            </div>
            <div className="mt-8 grid gap-3 lg:grid-cols-2">
              {kb.faqs.map((q) => (
                <details key={q.section} className="group rounded-xl border border-border bg-surface px-5 py-4 open:border-accent/40">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-text [&::-webkit-details-marker]:hidden">
                    {sentenceCase(q.section)}
                    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-45" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                      <path d="M10 4v12M4 10h12" />
                    </svg>
                  </summary>
                  <p className="mt-3 whitespace-pre-line text-sm leading-6 text-muted">{q.content.trim()}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* Limits */}
        <section className="mx-auto max-w-6xl pt-20">
          <Eyebrow>Privacy and limits</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-text sm:text-3xl">What Koya will and won&apos;t do</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LIMITS.map((l) => (
              <li key={l.title} className="rounded-xl border border-border bg-surface p-5">
                <h3 className="text-base font-semibold text-text">{l.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{l.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto max-w-6xl py-20">
          <div className="dot-grid flex flex-col items-start justify-between gap-6 rounded-2xl bg-navy px-6 py-10 text-on-navy sm:flex-row sm:items-center sm:px-10">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Have a question about RelayPay?</h2>
              <p className="mt-2 text-sm text-on-navy-muted">Koya replies in seconds, by voice or chat.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/support" className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-navy hover:bg-accent-soft">
                Talk to Koya
              </Link>
              {!session && (
                <Link href="/signin" className="rounded-md border border-navy-line px-5 py-3 text-sm font-medium text-on-navy hover:bg-white/10">
                  Sign in as user
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <Image src="/relaypay-mark.svg" alt="" width={22} height={22} />
            <span>© {new Date().getFullYear()} RelayPay. Conversations are logged to improve support.</span>
          </div>
          <span>Koya never asks for passwords or full account numbers.</span>
        </div>
      </footer>
    </div>
  );
}
