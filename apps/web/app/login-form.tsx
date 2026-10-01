"use client";

import { useActionState, useState } from "react";
import { login, type LoginState } from "./lib/auth-actions";

const field =
  "h-11 w-full rounded-md border border-border bg-surface px-3.5 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form action={action} className="space-y-4" noValidate>
      <div>
        <label htmlFor="identifier" className="mb-1.5 block text-sm font-medium text-text">
          Email or first name
        </label>
        <input
          id="identifier"
          name="identifier"
          autoComplete="username"
          required
          defaultValue={state.identifier}
          placeholder="amara@lagosledger.example"
          className={field}
          aria-invalid={Boolean(state.error)}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-text">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className={`${field} pr-11`}
            aria-invalid={Boolean(state.error)}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            aria-controls="password"
            title={showPassword ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted hover:text-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            {showPassword ? (
              // Eye with a slash: password is visible, click to hide it.
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 3l18 18" />
                <path d="M10.6 5.1A10.5 10.5 0 0 1 12 5c5.2 0 8.8 4.3 9.8 7-.4 1.1-1.2 2.5-2.4 3.8M6.6 6.6C4.6 7.9 3.1 9.9 2.2 12c1 2.7 4.6 7 9.8 7 1.9 0 3.6-.6 5-1.4" />
                <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
              </svg>
            ) : (
              // Open eye: password is hidden, click to show it.
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2.2 12C3.2 9.3 6.8 5 12 5s8.8 4.3 9.8 7c-1 2.7-4.6 7-9.8 7s-8.8-4.3-9.8-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {state.error && (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-md bg-brand text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
