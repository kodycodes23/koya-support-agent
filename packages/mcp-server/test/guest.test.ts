import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONVERSATION_HEADER, createLogger } from "@koya/shared";
import { createApp } from "../src/app.ts";
import { createFakeDb } from "./fake-db.ts";

const TOKEN = "test-token";
const fake = createFakeDb();
let server: Server;
let url: URL;

beforeAll(async () => {
  const app = createApp({ db: fake.client, log: createLogger("test", "silent"), embeddings: null, authToken: TOKEN });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
});
afterAll(() => server.close());

async function call(conversationId: string, name: string, args: Record<string, unknown>) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${TOKEN}`, [CONVERSATION_HEADER]: conversationId } } }));
  const res = await client.callTool({ name, arguments: args });
  await client.close();
  return res.structuredContent as Record<string, unknown>;
}

function conversation(channel: string, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  fake.tables.conversations!.push({ id, channel, verified_customer_id: null, metadata: {}, ...extra });
  return id;
}

describe("guest callers (public website, not signed in)", () => {
  it("get no account tools, even with a valid reference", async () => {
    const guest = conversation("chat");
    for (const [tool, args] of [
      ["lookup_transaction", { transaction_id: "TXN-9001" }],
      ["lookup_payout", { payout_id: "PAY-7001" }],
      ["lookup_customer", { customer_id: "CUS-1001", company_name: "LagosLedger", contact_name: "Amara Okafor" }],
      ["create_support_ticket", { caller_agreement: "yes", category: "other", priority: "low", summary: "Testing a guest ticket." }],
    ] as const) {
      const res = await call(guest, tool, args);
      expect(res, tool).toMatchObject({ ok: false, guest: true });
      expect(JSON.stringify(res)).not.toMatch(/2400|Kofi|amount|recipient/i);
    }
    expect(fake.tables.tool_call_logs!.filter((l) => l.conversation_id === guest).every((l) => l.status === "denied")).toBe(true);
  });

  it("can still search the knowledge base and request an onboarding callback", async () => {
    const guest = conversation("voice");
    expect(await call(guest, "search_knowledge_base", { query: "fees for international payments" })).toMatchObject({ found: true });
    const res = await call(guest, "create_escalation", { user_name: "Kemi Ade", user_email: "kemi@example.com", category: "onboarding", reason: "Wants to open an account for her design studio.", preferred_time: "tomorrow at 2pm" });
    expect(res).toMatchObject({ escalation_id: expect.stringMatching(/^ESC-/) });
    expect(fake.tables.escalations!.at(-1)).toMatchObject({ category: "onboarding", user_email: "kemi@example.com" });
  });

  it("request_sign_in records the pending question; once signed in, the account tools work again", async () => {
    const guest = conversation("chat");
    expect(await call(guest, "request_sign_in", { pending_question: "Where is payout PAY-7001?" })).toMatchObject({ sign_in_window_opened: true });
    expect(fake.tables.conversation_events!.find((e) => e.conversation_id === guest && e.event_type === "sign_in_requested")).toMatchObject({ metadata: { pending_question: "Where is payout PAY-7001?" } });

    fake.tables.conversations!.find((c) => c.id === guest)!.verified_customer_id = "CUS-1001";
    expect(await call(guest, "lookup_payout", { payout_id: "PAY-7001" })).toMatchObject({ found: true });
    expect(await call(guest, "request_sign_in", { pending_question: "anything" })).toMatchObject({ already_signed_in: true });
  });

  it("does not affect text/eval conversations, which verify by voice details as before", async () => {
    expect(await call(conversation("text"), "lookup_transaction", { transaction_id: "TXN-9001" })).toMatchObject({ found: true });
    expect(await call(conversation("eval", { metadata: { guest: true } }), "lookup_transaction", { transaction_id: "TXN-9001" })).toMatchObject({ guest: true });
  });
});

describe("typed names and emails", () => {
  it("override what speech-to-text heard when an escalation is created", async () => {
    const convo = conversation("voice");
    fake.tables.conversation_events!.push(
      { id: randomUUID(), conversation_id: convo, event_type: "typed_input", metadata: { field: "name", value: "Chikodi Agorua" }, created_at: new Date(Date.now() - 2000).toISOString() },
      { id: randomUUID(), conversation_id: convo, event_type: "typed_input", metadata: { field: "email", value: "Chikodi@Example.com" }, created_at: new Date(Date.now() - 1000).toISOString() },
    );
    await call(convo, "create_escalation", { user_name: "Chi Kodi a Gorua", user_email: "chi@example.com", category: "onboarding", reason: "Wants to open an account.", preferred_time: "Monday 9am" });
    expect(fake.tables.escalations!.at(-1)).toMatchObject({ user_name: "Chikodi Agorua", user_email: "chikodi@example.com" });
  });
});
