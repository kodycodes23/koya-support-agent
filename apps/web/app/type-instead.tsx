"use client";

import { useState } from "react";

/**
 * During a voice call: type a name, email or reference instead of saying it, or correct one Koya
 * misheard. Highlighted when Koya has just asked for one of those.
 */
export function TypeInstead({ onSend, prompted }: { onSend: (text: string) => void; prompted: boolean }) {
  const [value, setValue] = useState("");
  const submit = () => {
    if (!value.trim()) return;
    onSend(value);
    setValue("");
  };
  return (
    <form
      className={`mt-5 max-w-md rounded-lg border p-3 transition-colors ${prompted ? "border-accent-on-navy bg-white/10" : "border-navy-line"}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="koya-type-instead" className="block text-xs font-medium uppercase tracking-[0.14em] text-on-navy-muted">
        {prompted ? "Koya is asking: type it here if you prefer" : "Type a name, email or reference instead"}
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="koya-type-instead"
          value={value}
          maxLength={200}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Kosisochukwu Nebolisa"
          className="h-10 min-w-0 flex-1 rounded-md border border-navy-line bg-navy px-3 text-sm text-on-navy placeholder:text-on-navy-muted/60 focus:border-accent-on-navy focus:outline-none"
        />
        <button type="submit" disabled={!value.trim()} className="h-10 rounded-md bg-white px-4 text-sm font-semibold text-navy hover:bg-accent-soft disabled:opacity-50">
          Send
        </button>
      </div>
      <p className="mt-2 text-xs text-on-navy-muted">Koya uses exactly what you type, and it replaces anything it misheard.</p>
    </form>
  );
}
