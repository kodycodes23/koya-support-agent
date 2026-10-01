import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@koya/shared";
import { SIGN_IN_REQUIRED_REPLY, createApp } from "../src/app.ts";
import type { ConversationRecord, ConversationStore } from "../src/db.ts";
import type { TurnService } from "../src/agent/turn-service.ts";

const SECRET = "s".repeat(40);
const token = (sub = "CUS-1001") =>
  new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuer("relaypay-web").setAudience("koya-call").setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(SECRET));

function setup(requireSignedIn: boolean) {
  const convo: ConversationRecord = { id: "c1", channel: "voice", vapi_call_id: "call-1", agent_session_id: null, verified_customer_id: null, final_status: "active", ended_at: null };
  const store = {
    forVapiCall: vi.fn(async () => convo),
    create: vi.fn(),
    logEvent: vi.fn(async () => undefined),
    markSignedIn: vi.fn(async (c: ConversationRecord, id: string) => {
      c.verified_customer_id = id;
      return "briefing";
    }),
  } as unknown as ConversationStore;
  const handleTurn = vi.fn(async () => ({ reply: "Agent reply" }));
  const turns = { handleTurn } as unknown as TurnService;
  const app = createApp({ store, turns, log: createLogger("test", "silent"), model: "m", identitySecret: SECRET, requireSignedIn });
  const post = (metadata?: Record<string, unknown>) =>
    app.request("/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stream: false, call: { id: "call-1" }, messages: [{ role: "user", content: "Check my account" }], ...(metadata ? { metadata } : {}) }),
    });
  return { post, handleTurn, store };
}

const replyOf = async (res: Response) => ((await res.json()) as { choices: { message: { content: string } }[] }).choices[0]!.message.content;

describe("signed-in caller requirement", () => {
  it("rejects a voice call without a token and never runs the agent", async () => {
    const { post, handleTurn, store } = setup(true);
    expect(await replyOf(await post())).toBe(SIGN_IN_REQUIRED_REPLY);
    expect(handleTurn).not.toHaveBeenCalled();
    expect(store.logEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects a forged token", async () => {
    const { post, handleTurn } = setup(true);
    const forged = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("CUS-1001").setIssuer("relaypay-web").setAudience("koya-call").setExpirationTime("5m").sign(new TextEncoder().encode("f".repeat(40)));
    expect(await replyOf(await post({ identityToken: forged }))).toBe(SIGN_IN_REQUIRED_REPLY);
    expect(handleTurn).not.toHaveBeenCalled();
  });

  it("runs the agent for a signed-in caller", async () => {
    const { post, handleTurn } = setup(true);
    expect(await replyOf(await post({ identityToken: await token() }))).toBe("Agent reply");
    expect(handleTurn).toHaveBeenCalledTimes(1);
  });

  it("allows anonymous callers when the requirement is off", async () => {
    const { post, handleTurn } = setup(false);
    expect(await replyOf(await post())).toBe("Agent reply");
    expect(handleTurn).toHaveBeenCalledTimes(1);
  });
});
