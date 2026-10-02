import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@koya/shared";
import { SIGN_IN_REQUIRED_REPLY, createApp } from "../src/app.ts";
import type { ConversationRecord, ConversationStore } from "../src/db.ts";
import type { TurnService } from "../src/agent/turn-service.ts";

const SECRET = "s".repeat(40);
const token = (sub = "CUS-1001") =>
  new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuer("relaypay-web").setAudience("koya-call").setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(SECRET));

function setup(requireSignedIn: boolean, opts: { channel?: "voice" | "chat"; hadTurns?: boolean; toolsUsed?: string[] } = {}) {
  const convo: ConversationRecord = { id: "c1", channel: opts.channel ?? "voice", vapi_call_id: "call-1", agent_session_id: null, verified_customer_id: null, final_status: "active", ended_at: null, metadata: null };
  const store = {
    forVapiCall: vi.fn(async () => convo),
    create: vi.fn(),
    logEvent: vi.fn(async () => undefined),
    hasTurns: vi.fn(async () => opts.hadTurns ?? false),
    pendingSignInQuestion: vi.fn(async () => "Where is payout PAY-7001?"),
    markSignedIn: vi.fn(async (c: ConversationRecord, id: string) => {
      c.verified_customer_id = id;
      return { briefing: "briefing", firstName: "Amara" };
    }),
  } as unknown as ConversationStore;
  const handleTurn = vi.fn(async (_input: { userText: string; callerContext?: string }) => ({ reply: "Agent reply", toolsUsed: opts.toolsUsed ?? [] }));
  const turns = { handleTurn } as unknown as TurnService;
  const app = createApp({ store, turns, log: createLogger("test", "silent"), model: "m", identitySecret: SECRET, requireSignedIn });
  const send = (body: Record<string, unknown>) =>
    app.request("/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stream: false, ...body }) });
  const post = (metadata?: Record<string, unknown>) =>
    send({ call: { id: "call-1" }, messages: [{ role: "user", content: "Check my account" }], ...(metadata ? { metadata } : {}) });
  return { post, send, handleTurn, store };
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

describe("guests, chat and signing in mid-conversation", () => {
  it("briefs the agent that a caller without a token is a guest", async () => {
    const { post, handleTurn } = setup(false);
    await post();
    expect(handleTurn.mock.calls[0]![0].callerContext).toMatch(/Guest on RelayPay's public website/);
  });

  it("keeps a website chat in its own chat conversation and flags a sign-in request", async () => {
    const sessionId = "5b1f6c1e-2d7a-4c1e-9a7e-3f1d2c4b5a69";
    const { send, store } = setup(false, { channel: "chat", toolsUsed: ["request_sign_in"] });
    const res = await send({ metadata: { chatSessionId: sessionId }, messages: [{ role: "user", content: "Where is my payout?" }] });
    expect(store.forVapiCall).toHaveBeenCalledWith(expect.objectContaining({ callId: `chat:${sessionId}`, channel: "chat" }));
    expect(((await res.json()) as { koya?: unknown }).koya).toEqual({ signInRequested: true });
  });

  it("continues a guest call once the caller signs in: welcome back, then their earlier question", async () => {
    const { send, handleTurn } = setup(false, { hadTurns: true });
    await send({
      call: { id: "call-1" },
      messages: [
        { role: "user", content: "Where is my payout PAY-7001?" },
        { role: "assistant", content: "Please sign in using the window on your screen." },
        { role: "system", content: `[koya-identity:${await token()}]` },
      ],
    });
    const input = handleTurn.mock.calls[0]![0];
    expect(input.userText).toBe("I've signed in now.");
    expect(input.callerContext).toMatch(/Welcome back, Amara/);
    expect(input.callerContext).toMatch(/Where is payout PAY-7001\?/);
    expect(input.callerContext).not.toMatch(/Guest on RelayPay/);
  });

  it("ignores a forged token sent mid-call", async () => {
    const forged = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("CUS-1001").setIssuer("relaypay-web").setAudience("koya-call").setExpirationTime("5m").sign(new TextEncoder().encode("f".repeat(40)));
    const { send, handleTurn } = setup(false, { hadTurns: true });
    const res = await send({ call: { id: "call-1" }, messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }, { role: "system", content: `[koya-identity:${forged}]` }] });
    expect(handleTurn).not.toHaveBeenCalled();
    expect(await replyOf(res)).toMatch(/didn't catch that/);
  });
});
