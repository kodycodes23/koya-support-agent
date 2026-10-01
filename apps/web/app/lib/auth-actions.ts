"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate } from "./customers";
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

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
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

  await createSession(customerId);
  redirect("/dashboard"); // relative: works on any deployment host
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/");
}

export async function idleLogout(): Promise<void> {
  await deleteSession();
  redirect("/?signed-out=idle");
}
