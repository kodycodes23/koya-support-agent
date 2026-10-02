"use client";

import { useActionState, useEffect, useRef } from "react";
import { signInFromKoya, type KoyaSignInState } from "./lib/auth-actions";
import { PasswordField, fieldClass } from "./password-field";

/**
 * Opened when Koya asks a guest to sign in. Signing in here keeps the page (and the call or chat)
 * open; `onSignedIn` then hands the conversation over to the customer's account.
 */
export function SignInModal({ open, onClose, onSignedIn }: { open: boolean; onClose: () => void; onSignedIn: (firstName: string) => void }) {
  const [state, action, pending] = useActionState<KoyaSignInState, FormData>(signInFromKoya, {});
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const handled = useRef<KoyaSignInState | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      onSignedIn(state.firstName ?? "");
    }
  }, [state, onSignedIn]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="koya-signin-title"
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-border bg-surface p-0 text-text shadow-xl backdrop:bg-navy/60"
    >
      <div className="p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-accent">
              <span aria-hidden className="opacity-60">[</span>Koya is waiting<span aria-hidden className="opacity-60">]</span>
            </p>
            <h2 id="koya-signin-title" className="mt-2 text-xl font-semibold tracking-tight">Sign in to continue</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-background hover:text-text">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted">Koya will pick up right where you left off. Your conversation stays open.</p>
        <form action={action} className="mt-5 space-y-4" noValidate>
          <div>
            <label htmlFor="koya-identifier" className="mb-1.5 block text-sm font-medium">
              Email
            </label>
            <input id="koya-identifier" name="identifier" type="email" autoComplete="email" required defaultValue={state.identifier} className={fieldClass} aria-invalid={Boolean(state.error)} autoFocus />
          </div>
          <div>
            <label htmlFor="koya-password" className="mb-1.5 block text-sm font-medium">
              Password
            </label>
            <PasswordField id="koya-password" invalid={Boolean(state.error)} />
          </div>
          {state.error && (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {state.error}
            </p>
          )}
          <button type="submit" disabled={pending} className="h-11 w-full rounded-md bg-brand text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60">
            {pending ? "Signing in…" : "Sign in and continue"}
          </button>
        </form>
      </div>
    </dialog>
  );
}
