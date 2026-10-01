"use client";

import { useState, type FormEvent } from "react";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "done"; title: string; message: string; reference: string | null } | { kind: "error"; message: string };

const field =
  "h-11 w-full rounded-md border border-border bg-surface px-3.5 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

const DETAILS_MIN = 10;
const DETAILS_MAX = 500;

export function CallbackForm() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [topic, setTopic] = useState("payments");
  const [details, setDetails] = useState("");
  const needsDetails = topic === "other";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (needsDetails && details.trim().length < DETAILS_MIN) {
      setState({ kind: "error", message: "Please tell us a little more about the problem (at least 10 characters)." });
      return;
    }
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          topic: form.get("topic"),
          details: needsDetails ? details.trim() : undefined,
          preferredTime: form.get("preferredTime") || undefined,
          company: form.get("company") || undefined,
        }),
      });
      const body = (await res.json()) as { error?: string; message?: string; reference?: string | null; duplicate?: boolean; repeat?: boolean };
      if (!res.ok) throw new Error(body.error ?? "We couldn't send your request.");
      const title = body.duplicate ? "Already received" : body.repeat ? "Added to your open request" : "Request received";
      setState({ kind: "done", title, message: body.message ?? "A RelayPay specialist will be in touch.", reference: body.reference ?? null });
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }

  if (state.kind === "done") {
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-border bg-surface px-6 py-5 text-center" role="status">
        <p className="text-sm font-medium text-text">{state.title}{state.reference ? ` · reference ${state.reference}` : ""}</p>
        <p className="mt-1 text-sm text-muted">{state.message}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]" noValidate>
      <label className="sr-only" htmlFor="cb-name">Name</label>
      <input id="cb-name" name="name" required autoComplete="name" placeholder="Name" className={field} />
      <label className="sr-only" htmlFor="cb-email">Email</label>
      <input id="cb-email" name="email" type="email" required autoComplete="email" placeholder="Email" className={field} />
      <label className="sr-only" htmlFor="cb-topic">Topic</label>
      <select id="cb-topic" name="topic" value={topic} onChange={(e) => setTopic(e.target.value)} className={field}>
        <option value="payments">Payments and payouts</option>
        <option value="account">Account and verification</option>
        <option value="other">Something else</option>
      </select>
      <label className="sr-only" htmlFor="cb-time">Preferred time</label>
      <input id="cb-time" name="preferredTime" placeholder="Preferred time (optional)" className={field} />
      <button
        type="submit"
        disabled={state.kind === "sending"}
        className="h-11 rounded-md bg-brand px-5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60 sm:col-span-2 lg:col-span-1 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:h-auto"
      >
        {state.kind === "sending" ? "Sending…" : "Request a callback"}
      </button>
      {needsDetails && (
        <div className="text-left sm:col-span-2 lg:col-span-3">
          <label htmlFor="cb-details" className="mb-1.5 block text-sm font-medium text-text">
            Tell us more about the problem
          </label>
          <textarea
            id="cb-details"
            name="details"
            required
            rows={4}
            maxLength={DETAILS_MAX}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="What's happening, and anything a specialist should know before they call. Please don't include passwords or full account numbers."
            className="w-full rounded-md border border-border bg-surface px-3.5 py-2.5 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            aria-describedby="cb-details-count"
          />
          <p id="cb-details-count" className="mt-1 text-right text-xs text-muted">
            {details.length}/{DETAILS_MAX}
          </p>
        </div>
      )}
      {/* Honeypot for bots: hidden from people and assistive tech. */}
      <input name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {state.kind === "error" && (
        <p className="text-sm text-danger sm:col-span-2 lg:col-span-3" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
