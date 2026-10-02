"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate } from "./customers";
import { db } from "./db";
import { createSession, deleteSession } from "./session";

export interface LoginState {
  error?: string;
  identifier?: string;
}

// Simple per-IP throttle for the public login form (in-memory; one server instance).
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, number[]>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > MAX_ATTEMPTS;
}

/** Shared checks for both sign-in forms: the customer ID on success, or the error to show. */
async function authenticateForm(formData: FormData): Promise<{ customerId: string } | LoginState> {
  const identifier = String(formData.get("identifier") ?? "").slice(0, 200);
  const password = String(formData.get("password") ?? "").slice(0, 200);
  if (!identifier.trim() || !password) return { error: "Enter your email or first name, and your password.", identifier };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (throttled(ip)) return { error: "Too many sign-in attempts. Please wait a few minutes and try again.", identifier };

  let customerId: string | null = null;
  try {
    customerId = (await authenticate(identifier, password))?.customer_id ?? null;
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "login failed", error: (err as Error).message }));
    return { error: "We couldn't sign you in right now. Please try again.", identifier };
  }
  if (!customerId) return { error: "Email or password is incorrect.", identifier };
  return { customerId };
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const result = await authenticateForm(formData);
  if (!("customerId" in result)) return result;
  await createSession(result.customerId);
  redirect("/dashboard"); // relative: works on any deployment host
}

export interface KoyaSignInState extends LoginState {
  ok?: boolean;
  firstName?: string;
}

/**
 * Sign-in from the window Koya opens mid-conversation: same checks and session as the sign-in
 * page, but stays on the page so the call or chat can carry on as this customer.
 */
export async function signInFromKoya(_prev: KoyaSignInState, formData: FormData): Promise<KoyaSignInState> {
  const result = await authenticateForm(formData);
  if (!("customerId" in result)) return result;
  await createSession(result.customerId);
  const { data } = await db().from("customers").select("contact_name").eq("customer_id", result.customerId).maybeSingle();
  return { ok: true, firstName: String(data?.contact_name ?? "").split(/\s+/)[0] ?? "" };
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/signin");
}

export async function idleLogout(): Promise<void> {
  await deleteSession();
  redirect("/signin?signed-out=idle");
}
