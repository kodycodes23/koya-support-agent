"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./lib/auth-actions";
import { PasswordField, fieldClass as field } from "./password-field";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <div>
        <label htmlFor="identifier" className="mb-1.5 block text-sm font-medium text-text">
          Email
        </label>
        <input
          id="identifier"
          name="identifier"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.identifier}
          placeholder="you@company.com"
          className={field}
          aria-invalid={Boolean(state.error)}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-text">
          Password
        </label>
        <PasswordField invalid={Boolean(state.error)} />
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
