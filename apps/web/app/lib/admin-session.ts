import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/**
 * Support-admin session: a separate signed, HTTP-only cookie, so a customer session can never be
 * used to reach /admin (and the other way round). Signed with SESSION_SECRET, with its own audience.
 */
const COOKIE = "rp_admin";
const AUDIENCE = "relaypay-admin";
const MAX_AGE_SECONDS = 8 * 60 * 60;

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (32+ characters) is required in production");
    return new TextEncoder().encode("dev-only-session-secret-change-me-0000");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Admin sign-in details from ADMIN_USERNAME / ADMIN_PASSWORD. Locally they default to admin /
 * password; a production build has no default password, so admin sign-in stays off until it is set.
 */
export function adminCredentials(): { username: string; password: string } | null {
  const username = process.env.ADMIN_USERNAME?.trim() || "admin";
  const password = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "password");
  return password ? { username, password } : null;
}

/** Constant-time comparison of two strings of any length. */
export function sameSecret(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export async function createAdminSession(username: string): Promise<void> {
  const token = await new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getAdminSession(): Promise<{ username: string } | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"], audience: AUDIENCE });
    return payload.role === "admin" && typeof payload.sub === "string" ? { username: payload.sub } : null;
  } catch {
    return null;
  }
}

export async function deleteAdminSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
