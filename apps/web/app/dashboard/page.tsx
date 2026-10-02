import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { demoInvoices, demoWallets, money, type Tone } from "../dashboard-data";
import { IdleTimeout } from "../idle-timeout";
import { firstNameOf, getCustomerOverview } from "../lib/customers";
import { ProfileMenu } from "../profile-menu";
import { getSession, IDLE_TIMEOUT_SECONDS } from "../lib/session";

export const metadata: Metadata = {
  title: "Dashboard · RelayPay",
  description: "Your RelayPay business account overview.",
};

const NAV = ["Overview", "Payments", "Payouts", "Invoices", "Reports"];

/* ── Decorative line work (flat strokes, no gradients) ─────────────────────────────── */

function ContourLines() {
  const lines = Array.from({ length: 9 }, (_, i) => {
    const y = 40 + i * 58;
    return `M-40 ${y} C 260 ${y - 70}, 520 ${y + 90}, 820 ${y - 20} S 1260 ${y + 60}, 1500 ${y - 30}`;
  });
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1440 560" preserveAspectRatio="none" aria-hidden>
      {lines.map((d) => (
        <path key={d} d={d} fill="none" stroke="#0b2a5b" strokeOpacity="0.06" strokeWidth="1" />
      ))}
    </svg>
  );
}

function FlowLines() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 560 480" preserveAspectRatio="none" fill="none" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => {
        const x = 150 + i * 52;
        return (
          <path
            key={i}
            d={`M${x - 90} 480 C ${x - 40} 360, ${x + 50} 300, ${x + 10} 190 S ${x + 60} 40, ${x + 150} -10`}
            stroke="#0891b2"
            strokeOpacity={0.12 + i * 0.035}
            strokeWidth="1.5"
          />
        );
      })}
    </svg>
  );
}

function CardLines({ color }: { color: string }) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 320 190" preserveAspectRatio="none" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <path key={i} d={`M${140 + i * 22} 190 C ${180 + i * 20} 120, ${150 + i * 26} 70, ${330} ${20 + i * 12}`} fill="none" stroke={color} strokeOpacity="0.12" strokeWidth="1" />
      ))}
    </svg>
  );
}

function Contactless({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-6 w-6 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M8.5 8.5a5 5 0 0 1 0 7M12 6a8.5 8.5 0 0 1 0 12M15.5 3.5a12 12 0 0 1 0 17" />
    </svg>
  );
}

function MicIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/* ── Cards ────────────────────────────────────────────────────────────────────── */

type Wallet = ReturnType<typeof demoWallets>[number];

const CARD_FACE: Record<Tone, { face: string; text: string; muted: string; lines: string }> = {
  navy: { face: "bg-navy border border-white/20", text: "text-on-navy", muted: "text-on-navy-muted", lines: "#ffffff" },
  light: { face: "bg-surface", text: "text-text", muted: "text-muted", lines: "#0b2a5b" },
  teal: { face: "bg-accent-soft", text: "text-brand", muted: "text-brand/70", lines: "#0891b2" },
};

function WalletCard({ w }: { w: Wallet }) {
  const t = CARD_FACE[w.tone];
  return (
    <div className={`relative aspect-[1.7] overflow-hidden rounded-2xl p-5 ${t.face} ${t.text}`}>
      <CardLines color={t.lines} />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between">
          <div>
            <p className={`text-xs uppercase tracking-[0.14em] ${t.muted}`}>{w.name}</p>
            <p className="mt-1 text-sm font-semibold">{w.code}</p>
          </div>
          <Contactless className={t.muted} />
        </div>
        <div>
          <p className={`text-xs ${t.muted}`}>Available balance</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{w.balance}</p>
          <p className={`mt-2 font-mono text-xs ${t.muted}`}>•••• •••• •••• {w.last4}</p>
        </div>
      </div>
    </div>
  );
}

function HeroCard({ company, w }: { company: string; w: Wallet }) {
  return (
    <div className="relative mx-auto w-full max-w-sm -rotate-6">
      <div className="relative aspect-[1.6] overflow-hidden rounded-2xl bg-navy p-6 text-on-navy shadow-[0_24px_48px_-24px_rgba(11,42,91,0.55)]">
        <CardLines color="#ffffff" />
        <div className="relative flex h-full flex-col justify-between">
          <div className="flex items-center justify-between">
            <Image src="/relaypay-mark.svg" alt="" width={32} height={32} />
            <Contactless className="text-on-navy-muted" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-on-navy-muted">
              {company} · {w.code}
            </p>
            <p className="mt-1 text-3xl font-semibold tracking-tight">{w.balance}</p>
          </div>
          <div className="flex items-end justify-between font-mono text-sm text-on-navy-muted">
            <span>4532 •••• •••• {w.last4}</span>
            <span className="text-xs">09/29</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Status pills and panels ──────────────────────────────────────────────────── */

const STATUS: Record<string, { label: string; cls: string }> = {
  processing: { label: "Processing", cls: "bg-accent-soft text-accent" },
  scheduled: { label: "Scheduled", cls: "bg-accent-soft text-accent" },
  delayed: { label: "Delayed", cls: "bg-amber-50 text-amber-800" },
  "review required": { label: "Under review", cls: "bg-amber-50 text-amber-800" },
  failed: { label: "Failed", cls: "bg-danger-soft text-danger" },
  completed: { label: "Completed", cls: "bg-background text-muted" },
  sent: { label: "Sent", cls: "bg-accent-soft text-accent" },
  paid: { label: "Paid", cls: "bg-background text-muted" },
  draft: { label: "Draft", cls: "border border-border text-muted" },
};

function Pill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-background text-muted" };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const shortDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso)) : "";

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Account-level notices, in customer-safe words (internal support notes are never shown). */
function accountNotice(accountStatus: string, kycStatus: string): { title: string; body: string } | null {
  if (accountStatus === "restricted" || kycStatus === "review required") {
    return {
      title: "Your account is under review",
      body: "Some features are paused while a routine review is completed. A RelayPay specialist can help with next steps.",
    };
  }
  if (accountStatus === "pending verification" || kycStatus === "pending") {
    return { title: "Finish verifying your business", body: "Complete business verification to unlock full payment access." };
  }
  return null;
}

const ACCOUNT_LABEL: Record<string, string> = { active: "Active", restricted: "Restricted", "pending verification": "Pending verification" };
const KYC_LABEL: Record<string, string> = { approved: "KYC verified", pending: "KYC pending", "review required": "KYC under review" };

/* ── Page ─────────────────────────────────────────────────────────────────────── */

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const overview = await getCustomerOverview(session.customerId);
  if (!overview) redirect("/");
  const { customer, transactions, payouts } = overview;

  const firstName = firstNameOf(customer);
  const wallets = demoWallets(customer.customer_id, customer.region);
  const invoices = demoInvoices(customer.customer_id, customer.region);
  const notice = accountNotice(customer.account_status, customer.kyc_status);

  const activity = [
    ...transactions.map((t) => ({
      ref: t.transaction_id,
      kind: capitalise(t.transaction_type),
      counterparty: t.destination_country ?? "",
      amount: `${t.transaction_type === "outgoing payout" ? "−" : "+"}${money(Number(t.amount), t.currency)}`,
      date: t.created_at,
      detail: t.status === "completed" ? "Completed" : t.estimated_arrival ? `Expected ${shortDate(t.estimated_arrival)}` : "",
      status: t.status,
    })),
    ...payouts.map((p) => ({
      ref: p.payout_id,
      kind: "Contractor payout",
      counterparty: p.recipient_name,
      amount: `−${money(Number(p.amount), p.currency)}`,
      date: p.scheduled_for ?? "",
      // Failure reasons are customer-safe per the schema guide; review reasons are not shown.
      detail: p.status === "failed" && p.failure_reason ? capitalise(p.failure_reason) : p.transaction_id ? `Linked to ${p.transaction_id}` : "",
      status: p.status,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const inProgress = activity.filter((a) => a.status !== "completed").length;

  return (
    <div className="min-h-screen">
      <IdleTimeout timeoutSeconds={IDLE_TIMEOUT_SECONDS} />
      <header className="border-b border-border bg-surface">
        {/* Full width (not the centred content column), so the logo sits at the top-left, per the brand direction. */}
        <div className="flex w-full items-center justify-between gap-6 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-center gap-2.5" aria-label="RelayPay dashboard">
              <Image src="/relaypay-mark.svg" alt="" width={28} height={28} priority />
              <Image src="/relaypay-wordmark.svg" alt="RelayPay" width={98} height={13} priority />
            </Link>
            <nav className="hidden items-center gap-6 text-sm md:flex" aria-label="Dashboard">
              {NAV.map((item, i) => (
                <span
                  key={item}
                  aria-current={i === 0 ? "page" : undefined}
                  className={i === 0 ? "font-medium text-text" : "cursor-default text-muted"}
                  title={i === 0 ? undefined : "Not part of this demo"}
                >
                  {item}
                </span>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/support"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-sm font-medium text-text hover:border-accent hover:text-accent"
            >
              <MicIcon />
              <span className="hidden sm:inline">Help &amp; support</span>
              <span className="sm:hidden">Help</span>
            </Link>
            <ProfileMenu fullName={customer.contact_name} company={customer.company_name} email={customer.contact_email} />
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-surface">
        <ContourLines />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-20">
          <div>
            <p className="text-sm text-muted">
              {customer.company_name} · {customer.plan} plan ·{" "}
              <span className={customer.kyc_status === "approved" ? "text-accent" : "text-amber-700"}>{KYC_LABEL[customer.kyc_status] ?? customer.kyc_status}</span>
            </p>
            <h1 className="mt-4 text-5xl font-semibold uppercase leading-[0.95] tracking-tight text-text sm:text-6xl">
              Welcome
              <br />
              back,
              <br />
              {firstName}
            </h1>
            <p className="mt-6 text-sm uppercase tracking-[0.35em] text-brand">
              Your business <span className="border-b-2 border-accent pb-1">at a glance</span>
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <span className="cursor-default rounded-md bg-brand px-5 py-3 text-sm font-medium text-white" title="Not part of this demo">
                Send a payment
              </span>
              <Link href="/support" className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-5 py-3 text-sm font-medium text-text hover:border-accent hover:text-accent">
                <MicIcon />
                Ask Koya for help
              </Link>
            </div>
          </div>
          <div className="relative min-h-[18rem]">
            <FlowLines />
            <div className="relative flex h-full items-center py-6">
              <HeroCard company={customer.company_name} w={wallets[0]!} />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-navy">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-on-navy">Accounts</h2>
            <p className="text-xs text-on-navy-muted">Demo balances</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {wallets.map((w) => (
              <WalletCard key={w.code} w={w} />
            ))}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {notice && (
          <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-amber-900">{notice.title}</p>
              <p className="mt-1 text-sm text-amber-900/80">{notice.body}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link href="/support" className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
                <MicIcon />
                Talk to Koya
              </Link>
              <Link href="/support#callback" className="rounded-md border border-amber-300 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100">
                Request a callback
              </Link>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Payments in progress", value: String(inProgress), note: "Tracked below" },
            { label: "Invoices awaiting payment", value: String(invoices.filter((i) => i.status === "sent").length), note: "Demo data" },
            { label: "Account status", value: ACCOUNT_LABEL[customer.account_status] ?? customer.account_status, note: KYC_LABEL[customer.kyc_status] ?? customer.kyc_status },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-surface p-5">
              <p className="text-xs uppercase tracking-[0.14em] text-muted">{s.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-text">{s.value}</p>
              <p className="mt-1 text-xs text-muted">{s.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.7fr_1fr]">
          <div className="space-y-6">
            <Panel title="Recent activity" action={<span className="text-xs text-muted">From your RelayPay records</span>}>
              {activity.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted">No payments yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {activity.map((a) => (
                    <li key={a.ref} className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4 sm:grid-cols-[1.4fr_1fr_auto_auto]">
                      <div>
                        <p className="text-sm font-medium text-text">{a.kind}</p>
                        <p className="text-xs text-muted">
                          {a.counterparty ? `${a.counterparty} · ` : ""}
                          <span className="font-mono">{a.ref}</span>
                        </p>
                      </div>
                      <p className="hidden text-xs text-muted sm:block">
                        {shortDate(a.date)}
                        {a.detail && (
                          <>
                            <br />
                            {a.detail}
                          </>
                        )}
                      </p>
                      <p className="text-right text-sm font-semibold text-text">{a.amount}</p>
                      <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:justify-end">
                        <Pill status={a.status} />
                        {a.status !== "completed" && (
                          <Link href="/support" className="text-xs font-medium text-accent hover:underline">
                            Ask Koya
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Invoices" action={<span className="text-xs text-muted">Demo data</span>}>
              <ul className="divide-y divide-border">
                {invoices.map((inv) => (
                  <li key={inv.number} className="flex items-center justify-between gap-4 px-5 py-4">
                    <div>
                      <p className="text-sm font-medium text-text">{inv.client}</p>
                      <p className="text-xs text-muted">
                        <span className="font-mono">{inv.number}</span> · {inv.due}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <p className="text-sm font-semibold text-text">{inv.amount}</p>
                      <Pill status={inv.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <aside className="space-y-6">
            <section className="relative overflow-hidden rounded-2xl bg-navy p-6 text-on-navy">
              <CardLines color="#ffffff" />
              <div className="relative">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent-on-navy">Self-service</p>
                <h2 className="mt-3 text-xl font-semibold tracking-tight">Need help? Talk to Koya.</h2>
                <p className="mt-2 text-sm leading-6 text-on-navy-muted">
                  Our voice assistant can explain fees and timelines, check a transaction or payout, and connect you with a specialist.
                </p>
                <Link href="/support" className="mt-5 inline-flex items-center gap-2 rounded-md bg-white px-4 py-2.5 text-sm font-semibold text-navy hover:bg-accent-soft">
                  <MicIcon />
                  Start a voice call
                </Link>
                <p className="mt-5 text-xs uppercase tracking-[0.14em] text-on-navy-muted/80">You could ask</p>
                <ul className="mt-2 space-y-1.5 text-sm text-on-navy">
                  <li>&ldquo;I&apos;m {firstName} from {customer.company_name}. Can you check my account?&rdquo;</li>
                  {activity[0] && <li>&ldquo;What&apos;s happening with {activity[0].ref}?&rdquo;</li>}
                  <li>&ldquo;What fees apply to international payments?&rdquo;</li>
                </ul>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-surface p-6">
              <h2 className="text-sm font-semibold text-text">Prefer a person?</h2>
              <p className="mt-2 text-sm leading-6 text-muted">Request a callback and a RelayPay specialist will get in touch.</p>
              <Link href="/support#callback" className="mt-4 inline-flex rounded-md border border-border px-4 py-2 text-sm font-medium text-text hover:border-accent hover:text-accent">
                Request a callback
              </Link>
            </section>
          </aside>
        </div>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:justify-between sm:px-6">
          <span>
            © {new Date().getFullYear()} RelayPay · {customer.company_name}
          </span>
          <span>Balances and invoices shown here are demo data.</span>
        </div>
      </footer>

      <Link
        href="/support"
        className="fixed bottom-5 right-5 z-20 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-3 text-sm font-medium text-white shadow-lg shadow-brand/20 hover:bg-brand-hover"
      >
        <MicIcon />
        Help
      </Link>
    </div>
  );
}
