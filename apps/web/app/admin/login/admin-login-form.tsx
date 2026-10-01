"use client";

import { useActionState } from "react";
import { adminLogin, type AdminLoginState } from "../../lib/admin-actions";
import { PasswordField, fieldClass } from "../../password-field";

export function AdminLoginForm() {
  const [state, action, pending] = useActionState<AdminLoginState, FormData>(adminLogin, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <div>
        <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-text">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          required
          defaultValue={state.username}
          className={fieldClass}
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
        {pending ? "Signing in…" : "Sign in to admin"}
      </button>
    </form>
  );
}
