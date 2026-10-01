import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { adminLogout } from "../lib/admin-actions";
import { caseCounts, listCases, STATUS_FILTERS, type CaseKind, type CaseRow, type StatusFilter } from "../lib/admin-data";
import { getAdminSession } from "../lib/admin-session";
import { StatusControl } from "./status-control";

export const metadata: Metadata = {
  title: "Support admin · RelayPay",
  description: "Escalations and support tickets from Koya.",
};

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-accent-soft text-accent" },
  in_progress: { label: "In progress", cls: "bg-accent-soft text-accent" },
  pending: { label: "Pending", cls: "bg-amber-50 text-amber-800" },
  closed: { label: "Closed", cls: "bg-background text-muted" },
};

const ERRORS: Record<string, string> = {
  "pending-migration":
    "“Pending” needs the latest database migration. Run supabase/migrations/20261001000005_case_status_pending.sql in the Supabase SQL editor, then try again.",
  "update-failed": "That change couldn't be saved. Please try again.",
  invalid: "That request wasn't valid. Please try again.",
};

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso)) + " UTC";
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const href = (view: CaseKind, status: StatusFilter) => `/admin?view=${view}${status === "all" ? "" : `&status=${status}`}`;

function Pill({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted sm:text-xs sm:tracking-[0.14em]">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-text">{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

function CaseItem({ c, back }: { c: CaseRow; back: string }) {
  const status = STATUS_STYLE[c.status] ?? { label: c.status, cls: "bg-background text-muted" };
  const meta = [
    c.preferredTime ? `Callback: ${c.preferredTime}` : null,
    c.transactionId ? `Transaction: ${c.transactionId}` : null,
    `Source: ${c.source}`,
  ].filter(Boolean);
  return (
    <li className="px-5 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-text">{c.ref}</span>
            <Pill cls={status.cls}>{status.label}</Pill>
            <Pill cls="border border-border text-muted">{capitalise(c.category)}</Pill>
            {c.priority && <Pill cls={c.priority === "high" || c.priority === "urgent" ? "bg-danger-soft text-danger" : "border border-border text-muted"}>{capitalise(c.priority)} priority</Pill>}
            {c.repeats > 0 && <Pill cls="bg-amber-50 text-amber-800">Contacted again{c.repeats > 1 ? ` ×${c.repeats}` : ""}</Pill>}
          </div>
          <p className="mt-1.5 text-sm text-text">
            {c.customerName ?? "Unknown caller"}
            {c.company && <span className="text-muted"> · {c.company}</span>}
            {c.email && <span className="text-muted"> · {c.email}</span>}
          </p>
          <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-muted">{c.summary}</p>
          <p className="mt-1.5 text-xs text-muted">
            {when(c.createdAt)} · {meta.join(" · ")}
          </p>
          <details className="group mt-2 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-accent hover:underline">Full details</summary>
            <dl className="mt-2 grid gap-x-6 gap-y-1.5 rounded-lg bg-background p-3 text-xs sm:grid-cols-[auto_1fr]">
              <dt className="text-muted">{c.kind === "escalation" ? "Reason" : "Summary"}</dt>
              <dd className="whitespace-pre-wrap text-text">{c.summary}</dd>
              {c.followUp && (
                <>
                  <dt className="text-muted">Promised</dt>
                  <dd className="text-text">{c.followUp}</dd>
                </>
              )}
              {c.customerId && (
                <>
                  <dt className="text-muted">Customer ID</dt>
                  <dd className="font-mono text-text">{c.customerId}</dd>
                </>
              )}
              {c.conversationId && (
                <>
                  <dt className="text-muted">Conversation</dt>
                  <dd className="break-all font-mono text-text">{c.conversationId}</dd>
                </>
              )}
            </dl>
          </details>
        </div>
        <div className="shrink-0">
          <StatusControl kind={c.kind} id={c.id} status={c.status} label={c.ref} back={back} />
        </div>
      </div>
    </li>
  );
}

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const admin = await getAdminSession();
  if (!admin) redirect("/admin/login");

  const params = await searchParams;
  const view: CaseKind = params.view === "tickets" || params.view === "ticket" ? "ticket" : "escalation";
  const status: StatusFilter = STATUS_FILTERS.includes(params.status as StatusFilter) ? (params.status as StatusFilter) : "all";
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const back = href(view, status);

  const [counts, cases] = await Promise.all([caseCounts(), listCases(view, status)]);
  const viewCounts = counts[view];
  const filterCount: Record<StatusFilter, number> = { all: viewCounts.total, open: viewCounts.open, pending: viewCounts.pending, closed: viewCounts.closed };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="flex w-full items-center justify-between gap-6 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="flex items-center gap-2.5" aria-label="RelayPay support admin">
              <Image src="/relaypay-mark.svg" alt="" width={28} height={28} priority />
              <Image src="/relaypay-wordmark.svg" alt="RelayPay" width={98} height={13} priority />
            </Link>
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">Support admin</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">
              Signed in as <span className="font-medium text-text">{admin.username}</span>
            </span>
            <form action={adminLogout}>
              <button type="submit" className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-text hover:border-danger hover:text-danger">
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Support cases</h1>
        <p className="mt-1 text-sm text-muted">Escalations and tickets from Koya calls and the callback form. Pending and open cases both count as open for duplicate checks; only Closed ends a case.</p>

        {error && (
          <p className="mt-5 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label="Open escalations" value={counts.escalation.open} note="Waiting for a specialist" />
          <Stat label="Pending escalations" value={counts.escalation.pending} note="Waiting on the customer or a third party" />
          <Stat label="Open tickets" value={counts.ticket.open} note="Waiting for follow-up" />
          <Stat label="Pending tickets" value={counts.ticket.pending} note="Waiting on the customer or a third party" />
        </div>

        <section className="mt-8 rounded-2xl border border-border bg-surface">
          <div className="flex flex-col gap-3 border-b border-border px-5 pt-4 sm:flex-row sm:items-end sm:justify-between">
            <nav className="flex gap-6 text-sm" aria-label="Case type">
              {(["escalation", "ticket"] as const).map((k) => (
                <Link
                  key={k}
                  href={href(k, status)}
                  aria-current={view === k ? "page" : undefined}
                  className={`-mb-px border-b-2 pb-3 font-medium ${view === k ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}
                >
                  {k === "escalation" ? "Escalations" : "Tickets"} <span className="text-muted">({counts[k].total})</span>
                </Link>
              ))}
            </nav>
            <nav className="flex flex-wrap gap-1.5 pb-3" aria-label="Filter by status">
              {STATUS_FILTERS.map((f) => (
                <Link
                  key={f}
                  href={href(view, f)}
                  aria-current={status === f ? "page" : undefined}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${status === f ? "bg-brand text-white" : "border border-border text-muted hover:text-text"}`}
                >
                  {capitalise(f)} {filterCount[f]}
                </Link>
              ))}
            </nav>
          </div>

          {cases.length ? (
            <ul className="divide-y divide-border">
              {cases.map((c) => (
                <CaseItem key={c.id} c={c} back={back} />
              ))}
            </ul>
          ) : (
            <p className="px-5 py-12 text-center text-sm text-muted">No {status === "all" ? "" : `${status} `}{view === "escalation" ? "escalations" : "tickets"}.</p>
          )}
        </section>
      </main>
    </div>
  );
}
