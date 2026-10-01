"use client";

import { useEffect, useRef, useState } from "react";
import { idleLogout, logout } from "./lib/auth-actions";

const WARNING_SECONDS = 60;
const KEEP_ALIVE_EVERY_MS = 60 * 1000;
// Shared across tabs, so activity in one tab keeps the others signed in too.
const LAST_ACTIVE_KEY = "rp_last_active";
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"] as const;

function readShared(): number {
  try {
    return Number(localStorage.getItem(LAST_ACTIVE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeShared(t: number): void {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(t));
  } catch {
    // Private mode or blocked storage: this tab still times out on its own.
  }
}

/**
 * Signs the customer out after `timeoutSeconds` without activity, with a one-minute warning.
 * `busy` (for example, a live voice call) counts as continuous activity. The server enforces the
 * same idle window on the session cookie, which this component keeps alive while there is activity.
 */
export function IdleTimeout({ timeoutSeconds, busy = false }: { timeoutSeconds: number; busy?: boolean }) {
  const lastActive = useRef(0);
  const lastKeepAlive = useRef(0);
  const signingOut = useRef(false);
  const busyRef = useRef(busy);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    const timeoutMs = timeoutSeconds * 1000;

    const signOut = () => {
      if (signingOut.current) return;
      signingOut.current = true;
      void idleLogout();
    };

    const keepAlive = (now: number) => {
      if (now - lastKeepAlive.current < KEEP_ALIVE_EVERY_MS) return;
      lastKeepAlive.current = now;
      fetch("/api/session", { method: "POST" })
        .then((res) => {
          if (res.status === 401) signOut(); // lapsed server-side, e.g. the absolute session limit
        })
        .catch(() => {}); // offline: the local timer still applies
    };

    const markActive = () => {
      const now = Date.now();
      lastActive.current = now;
      writeShared(now);
      keepAlive(now);
      setSecondsLeft(null);
    };

    const tick = () => {
      if (signingOut.current) return;
      if (busyRef.current) markActive();
      const now = Date.now();
      const last = Math.max(lastActive.current, readShared());
      const remaining = timeoutMs - (now - last);
      if (remaining <= 0) return signOut();
      setSecondsLeft(remaining <= WARNING_SECONDS * 1000 ? Math.ceil(remaining / 1000) : null);
    };

    markActive();
    const interval = window.setInterval(tick, 1000);
    // Waking from sleep or returning to the tab: check straight away rather than on the next tick.
    const onVisible = () => document.visibilityState === "visible" && tick();
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, markActive, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, markActive);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [timeoutSeconds]);

  if (secondsLeft === null) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 px-4" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-body">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl">
        <h2 id="idle-title" className="text-base font-semibold text-text">
          Are you still there?
        </h2>
        <p id="idle-body" className="mt-2 text-sm leading-6 text-muted" aria-live="polite">
          For your security, you&apos;ll be signed out in {secondsLeft} {secondsLeft === 1 ? "second" : "seconds"}.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <form action={logout}>
            <button type="submit" className="rounded-md px-4 py-2 text-sm font-medium text-muted hover:text-text">
              Log out
            </button>
          </form>
          <button type="button" autoFocus className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
