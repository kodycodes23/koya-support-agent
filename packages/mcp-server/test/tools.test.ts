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

async function connect(conversationId: string, token = TOKEN) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { authorization: `Bearer ${token}`, [CONVERSATION_HEADER]: conversationId } },
    }),
  );
  return client;
}

async function call(conversationId: string, name: string, args: Record<string, unknown>) {
  const client = await connect(conversationId);
  const res = await client.callTool({ name, arguments: args });
  await client.close();
  return res.structuredContent as Record<string, unknown>;
}

function newConversation() {
  const id = randomUUID();
  fake.tables.conversations!.push({ id, channel: "text", verified_customer_id: null });
  return id;
}

describe("MCP server over Streamable HTTP", () => {
  it("rejects requests without the bearer token", async () => {
    await expect(connect(randomUUID(), "wrong")).rejects.toThrow();
  });

  it("lists every required tool", async () => {
    const client = await connect(randomUUID());
    const { tools } = await client.listTools();
    await client.close();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["create_escalation", "create_support_ticket", "log_conversation_event", "lookup_customer", "lookup_payout", "lookup_transaction", "request_sign_in", "search_knowledge_base"],
    );
  });

  it("search_knowledge_base returns the fee policy and writes a retrieval log", async () => {
    const convo = newConversation();
    const res = await call(convo, "search_knowledge_base", { query: "What fees does RelayPay charge for international payments?" });
    const chunks = res.chunks as { section: string; content: string }[];
    expect(chunks.some((c) => c.content.includes("displays applicable fees before a transaction is confirmed"))).toBe(true);
    expect(fake.tables.retrieval_logs!.find((r) => r.conversation_id === convo)).toMatchObject({ retrieval_mode: "fts" });
    expect(fake.tables.tool_call_logs!.find((r) => r.conversation_id === convo)).toMatchObject({ tool_name: "search_knowledge_base", status: "success" });
  });

  it("lookup_customer verifies Amara from LagosLedger and hides nothing unsafe", async () => {
    const convo = newConversation();
    const res = await call(convo, "lookup_customer", { contact_name: "Amara", company_name: "LagosLedger" });
    expect(res).toMatchObject({ found: true, verified: true, customer_id: "CUS-1001", account_status: "active" });
    expect(JSON.stringify(res)).not.toContain("amara@lagosledger.example");
    expect(fake.tables.conversations!.find((c) => c.id === convo)?.verified_customer_id).toBe("CUS-1001");
  });

  it("lookup_customer trusts a conversation already verified for that customer (signed-in caller)", async () => {
    const convo = newConversation();
    fake.tables.conversations!.find((c) => c.id === convo)!.verified_customer_id = "CUS-1003";
    const efua = await call(convo, "lookup_customer", { customer_id: "CUS-1003" });
    expect(efua).toMatchObject({ found: true, verified: true, account_status: "restricted" });
    // Recent activity lets Koya find "my payout" without a reference, without compliance reasoning.
    const activity = efua.recent_activity as { payouts: { reference: string; support_summary: string }[] };
    expect(activity.payouts[0]).toMatchObject({ reference: "PAY-7002", support_summary: expect.stringContaining("review") });
    // Status-level wording ("requires review") is customer-safe; internal risk reasoning never appears.
    expect(JSON.stringify(efua.recent_activity)).not.toMatch(/risk|suspicious|flagged/i);
    // …but not for a different customer.
    expect(await call(convo, "lookup_customer", { customer_id: "CUS-1001" })).toMatchObject({ found: true, verified: false });
  });

  it("lookup_customer with one factor returns no account details", async () => {
    const res = await call(newConversation(), "lookup_customer", { company_name: "AccraStack" });
    expect(res).toMatchObject({ found: true, verified: false });
    expect(res).not.toHaveProperty("account_status");
  });

  it("lookup_transaction redacts amounts for unverified callers", async () => {
    const res = await call(newConversation(), "lookup_transaction", { transaction_id: "txn 9001" });
    expect(res).toMatchObject({ found: true, transaction_id: "TXN-9001", status: "processing", redacted: true, escalation_recommended: false });
    expect(res).not.toHaveProperty("amount");
  });

  it("lookup_transaction reveals amounts to the verified owner", async () => {
    const convo = newConversation();
    await call(convo, "lookup_customer", { contact_name: "Amara", company_name: "LagosLedger" });
    const res = await call(convo, "lookup_transaction", { transaction_id: "TXN-9001" });
    expect(res).toMatchObject({ amount: "2400", currency: "USD", caller_verified_as_owner: true });
  });

  it("lookup_transaction handles unknown references without crashing", async () => {
    const convo = newConversation();
    expect(await call(convo, "lookup_transaction", { transaction_id: "TXN-0000" })).toMatchObject({ found: false });
    expect(fake.tables.tool_call_logs!.find((r) => r.conversation_id === convo)).toMatchObject({ status: "not_found" });
  });

  it("lookup_payout flags PAY-7002 for compliance escalation without leaking internals", async () => {
    const res = await call(newConversation(), "lookup_payout", { payout_id: "PAY-7002" });
    expect(res).toMatchObject({ status: "review required", escalation_recommended: true, escalation_category: "compliance", failure_reason: "under review" });
    expect(res).not.toHaveProperty("recipient_name");
  });

  it("create_support_ticket stores a ticket and returns its number", async () => {
    const convo = newConversation();
    const res = await call(convo, "create_support_ticket", {
      caller_agreement: "please log it",
      category: "invoice",
      priority: "medium",
      summary: "Invoice payment failed; customer wants it reviewed.",
      transaction_id: "TXN-9999",
    });
    expect(res).toMatchObject({ ticket_id: expect.stringMatching(/^TKT-\d+$/), status: "open" });
    // Unknown transaction reference is dropped rather than breaking the insert.
    expect(fake.tables.support_tickets!.at(-1)).toMatchObject({ conversation_id: convo, transaction_id: null });
  });

  it("create_support_ticket refuses to run without the caller's agreement", async () => {
    const client = await connect(newConversation());
    const res = await client.callTool({ name: "create_support_ticket", arguments: { category: "technical", priority: "medium", summary: "Dashboard shows a blank error." } });
    await client.close();
    expect(res.isError).toBe(true);
  });

  it("create_escalation stores the callback request and logs an event", async () => {
    const convo = newConversation();
    const res = await call(convo, "create_escalation", {
      user_name: "Efua Mensah",
      user_email: "Efua@AccraStack.example",
      category: "account",
      reason: "Account restricted; customer frustrated nobody is helping.",
      preferred_time: "tomorrow at 10am",
    });
    expect(res).toMatchObject({ escalation_id: expect.stringMatching(/^ESC-\d+$/), status: "open" });
    expect(String(res.follow_up_summary)).not.toContain("@");
    expect(fake.tables.escalations!.at(-1)).toMatchObject({ call_booked: true, user_email: "efua@accrastack.example" });
    expect(fake.tables.conversation_events!.some((e) => e.conversation_id === convo && e.event_type === "escalation_created")).toBe(true);
  });

  it("create_escalation fills contact details from the account for a verified caller, and refuses to guess otherwise", async () => {
    const verified = newConversation();
    fake.tables.conversations!.find((c) => c.id === verified)!.verified_customer_id = "CUS-1003";
    expect(await call(verified, "create_escalation", { category: "compliance", reason: "Payout on hold pending review." })).toMatchObject({ status: "open" });
    expect(fake.tables.escalations!.at(-1)).toMatchObject({ user_name: "Efua Mensah", user_email: "efua@accrastack.example", customer_id: "CUS-1003" });

    const anonymous = newConversation();
    expect(await call(anonymous, "create_escalation", { category: "other", reason: "Needs a callback." })).toMatchObject({ escalation_id: null });
  });

  it("create_escalation rejects an invalid email via schema validation", async () => {
    const client = await connect(newConversation());
    const res = await client.callTool({
      name: "create_escalation",
      arguments: { user_name: "X", user_email: "not-an-email", category: "other", reason: "testing validation" },
    });
    await client.close();
    expect(res.isError).toBe(true);
  });

  it("log_conversation_event logs with the header conversation id", async () => {
    const convo = newConversation();
    expect(await call(convo, "log_conversation_event", { event_type: "declined_unsupported", summary: "Asked for a guarantee" })).toEqual({ logged: true });
    expect(fake.tables.conversation_events!.some((e) => e.conversation_id === convo)).toBe(true);
  });
});
