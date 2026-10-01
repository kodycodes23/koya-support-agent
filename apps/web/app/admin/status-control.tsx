"use client";

import { useFormStatus } from "react-dom";
import { setCaseStatus } from "../lib/admin-actions";

const OPTIONS = [
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "closed", label: "Closed" },
] as const;

function Buttons({ current, label }: { current: string; label: string }) {
  const { pending, data } = useFormStatus();
  const target = pending ? String(data?.get("status") ?? "") : null;
  // "In progress" (set outside this page) shows as Open here.
  const active = current === "in_progress" ? "open" : current;
  return (
    <div role="group" aria-label={`Status of ${label}`} className="inline-flex overflow-hidden rounded-md border border-border">
      {OPTIONS.map((o, i) => {
        const isActive = target ? target === o.value : active === o.value;
        return (
          <button
            key={o.value}
            type="submit"
            name="status"
            value={o.value}
            disabled={pending || active === o.value}
            aria-pressed={active === o.value}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${i ? "border-l border-border" : ""} ${
              isActive ? "bg-brand text-white" : "bg-surface text-muted hover:bg-background hover:text-text"
            } disabled:cursor-default`}
          >
            {target === o.value ? "Saving…" : o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Open / Pending / Closed switch for one case. Works without JavaScript too (plain form post). */
export function StatusControl({ kind, id, status, label, back }: { kind: "escalation" | "ticket"; id: string; status: string; label: string; back: string }) {
  return (
    <form action={setCaseStatus}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
      <Buttons current={status} label={label} />
    </form>
  );
}
