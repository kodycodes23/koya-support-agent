import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@koya/shared";
import { createApp } from "../src/app.ts";
import type { ConversationRecord, ConversationStore } from "../src/db.ts";
import type { TurnService } from "../src/agent/turn-service.ts";
import { ReplayCache } from "../src/replay.ts";

describe("ReplayCache", () => {
  const msgs = (...texts: string[]) => texts.map((content, i) => ({ role: i % 2 ? "assistant" : "user", content }));

  it("keys on the whole conversation, so a repeated 'yes' in a later turn is not a duplicate", () => {
    expect(ReplayCache.keyFor("c", msgs("yes"))).toBe(ReplayCache.keyFor("c", msgs("yes")));
    expect(ReplayCache.keyFor("c", msgs("yes"))).not.toBe(ReplayCache.keyFor("c", msgs("yes", "Got it.", "yes")));
    expect(ReplayCache.keyFor("c", msgs("yes"))).not.toBe(ReplayCache.keyFor("other", msgs("yes")));
  });

  it("replays a finished reply within the window only, and tracks overlapping requests", () => {
    let now = 0;
    const cache = new ReplayCache(30_000, () => now);
    cache.start("k");
    cache.start("k");
    cache.finish("k", null); // the superseded original
    expect(cache.isRunning("k")).toBe(true);
    cache.finish("k", "Hello");
    expect(cache.isRunning("k")).toBe(false);
    expect(cache.replyFor("k")).toBe("Hello");
    now = 30_001;
    expect(cache.replyFor("k")).toBeNull();
  });
});

describe("resent Vapi requests", () => {
  it("are answered from the previous reply without running the agent again", async () => {
    const convo: ConversationRecord = { id: "c1", channel: "voice", vapi_call_id: "call-1", agent_session_id: null, verified_customer_id: "CUS-1001", final_status: "active", ended_at: null };
    const store = { forVapiCall: vi.fn(async () => convo), logEvent: vi.fn(async () => undefined) } as unknown as ConversationStore;
    const handleTurn = vi.fn(async () => ({ reply: "Your payout is processing.", status: "ok" }));
    const app = createApp({ store, turns: { handleTurn } as unknown as TurnService, log: createLogger("test", "silent"), model: "m" });
    const post = (messages: unknown[]) =>
      app.request("/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stream: false, call: { id: "call-1" }, messages }) });
    const replyOf = async (res: Response) => ((await res.json()) as { choices: { message: { content: string } }[] }).choices[0]!.message.content;

    const turn1 = [{ role: "user", content: "Where is PAY-7001?" }];
    expect(await replyOf(await post(turn1))).toBe("Your payout is processing.");
    expect(await replyOf(await post(turn1))).toBe("Your payout is processing.");
    expect(handleTurn).toHaveBeenCalledTimes(1);
    expect(store.logEvent).toHaveBeenCalledWith("c1", "duplicate_request", expect.any(String), { handling: "replayed" });

    await post([...turn1, { role: "assistant", content: "Your payout is processing." }, { role: "user", content: "Where is PAY-7001?" }]);
    expect(handleTurn).toHaveBeenCalledTimes(2);
  });
});
