import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONVERSATION_HEADER, createLogger, referencesIn, sameIssue } from "@koya/shared";
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
  await client.connect(
    new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${TOKEN}`, [CONVERSATION_HEADER]: conversationId } } }),
  );
  const res = await client.callTool({ name, arguments: args });
  await client.close();
  return res.structuredContent as Record<string, unknown>;
}

function conversation(customerId: string | null, channel = "voice") {
  const id = randomUUID();
  fake.tables.conversations!.push({ id, channel, verified_customer_id: customerId });
  return id;
}
const escalationsFor = (customerId: string) => fake.tables.escalations!.filter((e) => e.customer_id === customerId);
const events = (convo: string, type: string) => fake.tables.conversation_events!.filter((e) => e.conversation_id === convo && e.event_type === type);

describe("issue matching", () => {
  it("normalizes references from free text", () => {
    expect(referencesIn("Payout pay 7002 and TXN-9001, also txn9001", null)).toEqual(["PAY-7002", "TXN-9001"]);
  });
  it("matches on a shared reference, separates different references, else compares categories", () => {
    expect(sameIssue({ category: "payment", refs: ["TXN-9001"] }, { category: "dispute", refs: ["TXN-9001"] })).toBe(true);
    expect(sameIssue({ category: "payment", refs: ["TXN-9001"] }, { category: "payment", refs: ["TXN-9002"] })).toBe(false);
    expect(sameIssue({ category: "account", refs: [] }, { category: "account", refs: ["PAY-7002"] })).toBe(true);
    expect(sameIssue({ category: "account", refs: [] }, { category: "compliance", refs: [] })).toBe(false);
    // "other" only matches across calls by reference.
    expect(sameIssue({ category: "other", refs: [] }, { category: "other", refs: [] })).toBe(true);
    expect(sameIssue({ category: "other", refs: [] }, { category: "other", refs: [] }, { strict: true })).toBe(false);
  });
});

describe("duplicate escalations", () => {
  it("reuses the escalation when it is requested twice on the same call, without a second email or record", async () => {
    const convo = conversation("CUS-1002");
    const args = { category: "payment", reason: "Payout PAY-7101 is late and Daniel is frustrated.", preferred_time: "Friday at 2pm" };
    const [a, b] = await Promise.all([call(convo, "create_escalation", args), call(convo, "create_escalation", args)]);
    expect(a.escalation_id).toBe(b.escalation_id);
    expect(escalationsFor("CUS-1002")).toHaveLength(1);
    expect([a, b].filter((r) => r.already_open)).toHaveLength(1);
    expect(events(convo, "duplicate_prevented")).toHaveLength(1);
  });

  it("treats a later call about the same open issue as a repeat contact and updates the callback time", async () => {
    const later = conversation("CUS-1002");
    const res = await call(later, "create_escalation", { category: "payment", reason: "Calling again about PAY-7101, still not arrived.", preferred_time: "Monday morning" });
    expect(res).toMatchObject({ already_open: true, callback_time_updated: true });
    expect(String(res.next_step)).toMatch(/already has an open case/);
    expect(escalationsFor("CUS-1002")).toHaveLength(1);
    expect(escalationsFor("CUS-1002")[0]).toMatchObject({ preferred_time: "Monday morning", call_booked: true });
    expect(events(later, "repeat_contact")).toHaveLength(1);
  });

  it("opens a new case for a different issue, after the old one is closed, or in eval runs", async () => {
    expect(await call(conversation("CUS-1002"), "create_escalation", { category: "payment", reason: "Different payout PAY-7102 is missing." })).not.toHaveProperty("already_open");
    expect(await call(conversation("CUS-1002"), "create_escalation", { category: "compliance", reason: "Needs help with business verification." })).not.toHaveProperty("already_open");
    expect(await call(conversation("CUS-1002", "eval"), "create_escalation", { category: "compliance", reason: "Verification question again." })).not.toHaveProperty("already_open");

    for (const e of escalationsFor("CUS-1002")) e.status = "closed";
    expect(await call(conversation("CUS-1002"), "create_escalation", { category: "payment", reason: "PAY-7101 problem again." })).not.toHaveProperty("already_open");
  });

  it("ignores open cases older than 72 hours", async () => {
    fake.tables.escalations!.push({ id: randomUUID(), escalation_ref: "ESC-4999", customer_id: "CUS-1004", category: "account", reason: "Old case", status: "open", created_at: new Date(Date.now() - 80 * 3600_000).toISOString() });
    expect(await call(conversation("CUS-1004"), "create_escalation", { category: "account", reason: "Cannot log in to the dashboard." })).not.toHaveProperty("already_open");
  });
});

describe("duplicate tickets", () => {
  it("reuses a ticket on the same call and across calls for the same customer and issue", async () => {
    const convo = conversation("CUS-1005");
    const args = { category: "invoice", priority: "medium", caller_agreement: "yes, log it", summary: "Invoice payment failed; Patrick wants it reviewed." };
    const first = await call(convo, "create_support_ticket", args);
    expect(first).not.toHaveProperty("already_open");
    expect(await call(convo, "create_support_ticket", args)).toMatchObject({ ticket_id: first.ticket_id, already_open: true });
    expect(await call(conversation("CUS-1005"), "create_support_ticket", args)).toMatchObject({ ticket_id: first.ticket_id, already_open: true, opened: expect.any(String) });
    expect(fake.tables.support_tickets!.filter((t) => t.customer_id === "CUS-1005")).toHaveLength(1);
    // A different category is a different issue.
    expect(await call(convo, "create_support_ticket", { ...args, category: "technical", summary: "Dashboard export is broken." })).not.toHaveProperty("already_open");
  });
});
