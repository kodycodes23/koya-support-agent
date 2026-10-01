import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/**
 * Stateless session in a signed, HTTP-only cookie (pattern from the Next.js 16 authentication
 * guide). The cookie holds only the customer ID; everything else is read from the database.
 */
const COOKIE = "rp_session";
const MAX_AGE_SECONDS = 8 * 60 * 60; // absolute limit: one working day
/** Signed out after this long without activity. The browser (`IdleTimeout`) enforces it to the second. */
export const IDLE_TIMEOUT_SECONDS = 10 * 60;
// The server-side expiry slides on keep-alive pings (at most one per minute), so it gets a small
// grace period to never lapse before the browser timer does.
const IDLE_GRACE_SECONDS = 90;

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (32+ characters) is required in production");
    // Local development only: a fixed key so `pnpm web:dev` works before .env is filled in.
    return new TextEncoder().encode("dev-only-session-secret-change-me-0000");
  }
  return new TextEncoder().encode(secret);
}

export interface Session {
  customerId: string;
}

/**
 * Issues (or re-issues) the session cookie. `authTime` is when the customer signed in; the token
 * expires after the idle window, capped at the absolute limit from sign-in.
 */
export async function createSession(customerId: string, authTime = Math.floor(Date.now() / 1000)): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.min(now + IDLE_TIMEOUT_SECONDS + IDLE_GRACE_SECONDS, authTime + MAX_AGE_SECONDS);
  if (exp <= now) return;
  const token = await new SignJWT({ customerId, authTime })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secretKey());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: exp - now,
  });
}

async function readSession(): Promise<(Session & { authTime: number }) | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.customerId !== "string" || typeof payload.authTime !== "number") return null;
    return { customerId: payload.customerId, authTime: payload.authTime };
  } catch {
    return null; // expired (idle or absolute limit) or tampered
  }
}

export async function getSession(): Promise<Session | null> {
  const session = await readSession();
  return session && { customerId: session.customerId };
}

/** Slides the idle expiry forward. Only callable from a Server Action or Route Handler. */
export async function refreshSession(): Promise<boolean> {
  const session = await readSession();
  if (!session) return false;
  await createSession(session.customerId, session.authTime);
  return true;
}

export async function deleteSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
