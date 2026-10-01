import { jwtVerify } from "jose";

/**
 * Verifies the "signed-in caller" token issued by the web app (apps/web/app/lib/call-identity.ts).
 * Returns the customer ID when the signature, issuer, audience and expiry all check out; otherwise
 * null, and the call proceeds as an anonymous caller who verifies by voice.
 */
export async function verifyIdentityToken(token: string | undefined, secret: string | undefined): Promise<string | null> {
  if (!token || !secret || secret.length < 32) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      issuer: "relaypay-web",
      audience: "koya-call",
    });
    return typeof payload.sub === "string" && /^CUS-\d+$/.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}
