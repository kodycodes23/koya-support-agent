/**
 * End-to-end smoke test against a RUNNING MCP server and the real Supabase database.
 *   pnpm mcp:dev      (in one terminal)
 *   pnpm mcp:smoke    (in another)
 * Creates a text conversation, calls every tool (found and not-found paths), then
 * confirms the tool_call_logs / retrieval_logs / tickets / escalations rows exist.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { CONVERSATION_HEADER, createServiceClient, loadEnvFiles, optionalString, parseEnv, supabaseEnvSchema } from "@koya/shared";

loadEnvFiles();
const env = parseEnv(
  supabaseEnvSchema.extend({
    MCP_SERVER_URL: z.url().default("http://localhost:8787/mcp"),
    MCP_AUTH_TOKEN: optionalString,
  }),
);
const db = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: convo, error } = await db
  .from("conversations")
  .insert({ channel: "text", caller_id: "mcp-smoke", metadata: { source: "mcp:smoke" } })
  .select("id")
  .single();
if (error) throw new Error(`create conversation: ${error.message}`);
const conversationId = convo.id as string;

const client = new Client({ name: "koya-smoke", version: "0.1.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(env.MCP_SERVER_URL), {
    requestInit: {
      headers: {
        [CONVERSATION_HEADER]: conversationId,
        ...(env.MCP_AUTH_TOKEN ? { authorization: `Bearer ${env.MCP_AUTH_TOKEN}` } : {}),
      },
    },
  }),
);

const { tools } = await client.listTools();
console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}\n`);

const calls: [string, Record<string, unknown>][] = [
  ["search_knowledge_base", { query: "What fees does RelayPay charge for international payments?" }],
  ["search_knowledge_base", { query: "Can RelayPay guarantee payout arrival times?" }],
  ["lookup_customer", { company_name: "LagosLedger" }],
  ["lookup_customer", { contact_name: "Amara", company_name: "LagosLedger" }],
  ["lookup_customer", { email: "nobody@example.com", company_name: "Nowhere Ltd" }],
  ["lookup_transaction", { transaction_id: "TXN-9001" }],
  ["lookup_transaction", { transaction_id: "TXN-0000" }],
  ["lookup_payout", { payout_id: "PAY-7002" }],
  ["lookup_payout", { transaction_id: "TXN-9004" }],
  ["create_support_ticket", { caller_agreement: "yes please", category: "invoice", priority: "medium", summary: "[smoke] Invoice payment failed and needs review.", customer_id: "CUS-1001" }],
  ["create_escalation", { user_name: "Smoke Test", user_email: "smoke@example.com", category: "account", reason: "[smoke] Account restricted.", preferred_time: "tomorrow 10am" }],
  ["log_conversation_event", { event_type: "smoke_test", summary: "MCP smoke test ran" }],
];

let failures = 0;
for (const [name, args] of calls) {
  const res = await client.callTool({ name, arguments: args });
  const out = res.structuredContent as Record<string, unknown>;
  if (res.isError) failures++;
  const brief = name === "search_knowledge_base"
    ? { found: out.found, mode: out.retrieval_mode, sections: (out.chunks as { section: string }[]).map((c) => c.section) }
    : out;
  console.log(`${res.isError ? "✗" : "✓"} ${name} ${JSON.stringify(args)}\n  → ${JSON.stringify(brief)}\n`);
}
await client.close();

const count = async (table: string) => {
  const { count: n, error: e } = await db.from(table).select("*", { count: "exact", head: true }).eq("conversation_id", conversationId);
  if (e) throw new Error(`${table}: ${e.message}`);
  return n ?? 0;
};
const logged = {
  tool_call_logs: await count("tool_call_logs"),
  retrieval_logs: await count("retrieval_logs"),
  support_tickets: await count("support_tickets"),
  escalations: await count("escalations"),
  conversation_events: await count("conversation_events"),
};
console.log(`conversation ${conversationId}:`, logged);

const ok = failures === 0 && logged.tool_call_logs === calls.length && logged.retrieval_logs === 2 && logged.support_tickets === 1 && logged.escalations === 1;
console.log(ok ? "\nSMOKE PASSED" : "\nSMOKE FAILED");
process.exit(ok ? 0 : 1);
