"use server";

import { SignJWT } from "jose";
import { getSession } from "./session";

/**
 * Issues a short-lived signed token saying "this call is from signed-in customer X". The browser
 * passes it to Vapi as call metadata; the agent server verifies the signature with the same
 * KOYA_IDENTITY_SECRET and treats the caller as already verified. Returns null when signed out
 * or when the secret isn't configured (the call then falls back to voice verification).
 */
export async function getCallIdentityToken(): Promise<string | null> {
  const secret = process.env.KOYA_IDENTITY_SECRET;
  const session = await getSession();
  if (!session) return null;
  if (!secret || secret.length < 32) {
    // Without this the call silently goes out anonymous; make the misconfiguration visible.
    console.error("KOYA_IDENTITY_SECRET is not set for the web app (restart it after adding it to .env); Koya will treat this caller as signed out.");
    return null;
  }
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.customerId)
    .setIssuer("relaypay-web")
    .setAudience("koya-call")
    .setIssuedAt()
    .setExpirationTime("5m") // only needs to survive until the first turn of the call
    .sign(new TextEncoder().encode(secret));
}
