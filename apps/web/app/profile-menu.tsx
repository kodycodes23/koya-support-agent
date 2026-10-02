"use client";

import { useEffect, useId, useRef, useState } from "react";
import { logout } from "./lib/auth-actions";

export interface ProfileMenuProps {
  fullName: string;
  company: string;
  email?: string;
  /** Runs just before signing out (the Koya page ends a live call here). */
  onBeforeLogout?: () => void;
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/**
 * Avatar button that opens a small account menu: who is signed in (name, company, email), and Log out.
 * Closes on Escape and on a click outside.
 */
export function ProfileMenu({ fullName, company, email, onBeforeLogout }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white" aria-hidden>
          {initialsOf(fullName)}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-medium text-text">{fullName}</span>
          <span className="block text-xs text-muted">{company}</span>
        </span>
        <svg viewBox="0 0 20 20" className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="m5 7.5 5 5 5-5" />
        </svg>
        <span className="sr-only">Account menu</span>
      </button>

      {open && (
        <div id={menuId} role="menu" className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-brand/10">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-medium text-text">{fullName}</p>
            <p className="text-xs text-muted">{company}</p>
            {email && <p className="mt-1 truncate text-xs text-muted" title={email}>{email}</p>}
          </div>
          <div className="py-1">
            <form action={logout} onSubmit={() => onBeforeLogout?.()}>
              <button
                ref={firstItemRef}
                type="submit"
                role="menuitem"
                className="block w-full px-4 py-2.5 text-left text-sm font-medium text-danger hover:bg-danger-soft focus:bg-danger-soft focus:outline-none"
              >
                Log out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
