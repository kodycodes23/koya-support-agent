import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { verifyIdentityToken } from "../src/identity.ts";
import { chatRequestSchema, identityTokenOf } from "../src/routes/openai.ts";

const SECRET = "x".repeat(40);
const sign = (claims: { sub?: string; iss?: string; aud?: string; exp?: string }, secret = SECRET) =>
  new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub ?? "CUS-1001")
    .setIssuer(claims.iss ?? "relaypay-web")
    .setAudience(claims.aud ?? "koya-call")
    .setIssuedAt()
    .setExpirationTime(claims.exp ?? "5m")
    .sign(new TextEncoder().encode(secret));

describe("verifyIdentityToken", () => {
  it("accepts a valid token from the web app", async () => {
    expect(await verifyIdentityToken(await sign({}), SECRET)).toBe("CUS-1001");
  });
  it("rejects forged, expired, mis-addressed or malformed tokens", async () => {
    expect(await verifyIdentityToken(await sign({}, "y".repeat(40)), SECRET)).toBeNull();
    expect(await verifyIdentityToken(await sign({ exp: "-1m" }), SECRET)).toBeNull();
    expect(await verifyIdentityToken(await sign({ aud: "other" }), SECRET)).toBeNull();
    expect(await verifyIdentityToken(await sign({ sub: "admin" }), SECRET)).toBeNull();
    expect(await verifyIdentityToken("not-a-jwt", SECRET)).toBeNull();
  });
  it("is disabled without a secret", async () => {
    expect(await verifyIdentityToken(await sign({}), undefined)).toBeNull();
  });
});

describe("identityTokenOf", () => {
  it("reads the token from either place Vapi may send it", () => {
    const base = { messages: [{ role: "user", content: "hi" }] };
    expect(identityTokenOf(chatRequestSchema.parse({ ...base, metadata: { identityToken: "a" } }))).toBe("a");
    expect(identityTokenOf(chatRequestSchema.parse({ ...base, call: { id: "c", assistantOverrides: { metadata: { identityToken: "b" } } } }))).toBe("b");
    expect(identityTokenOf(chatRequestSchema.parse(base))).toBeUndefined();
  });
});
