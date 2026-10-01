/**
 * Read-only check that the live database matches supabase/migrations.
 * Selects every expected column (limit 0), so a missing table or column — e.g. an
 * older same-named table that `create table if not exists` silently kept — is reported.
 * Also probes the KB search functions and reports row counts. Writes nothing.
 */
import { createServiceClient } from "@koya/shared";
import { env } from "./env.ts";

const db = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const EXPECTED: Record<string, string[]> = {
  customers: ["customer_id", "company_name", "contact_name", "contact_email", "plan", "account_status", "region", "kyc_status", "support_notes"],
  transactions: ["transaction_id", "customer_id", "transaction_type", "amount", "currency", "destination_country", "status", "created_at", "estimated_arrival", "support_summary"],
  payouts: ["payout_id", "transaction_id", "customer_id", "recipient_name", "amount", "currency", "status", "scheduled_for", "failure_reason"],
  conversations: ["id", "channel", "vapi_call_id", "caller_id", "verified_customer_id", "agent_session_id", "started_at", "ended_at", "final_status", "ended_reason", "summary", "metadata", "created_at"],
  conversation_turns: ["id", "conversation_id", "turn_index", "user_transcript", "assistant_response", "answer_type", "confidence", "uncertainty_note", "tools_used", "latency_ms", "created_at"],
  retrieval_logs: ["id", "conversation_id", "query", "retrieval_mode", "chunk_ids", "chunks", "source_title", "source_summary", "created_at"],
  tool_call_logs: ["id", "conversation_id", "tool_name", "purpose", "input_summary", "result_summary", "status", "error_message", "duration_ms", "created_at"],
  support_tickets: ["id", "ticket_ref", "conversation_id", "customer_id", "transaction_id", "category", "priority", "summary", "status", "created_at"],
  escalations: ["id", "escalation_ref", "conversation_id", "ticket_id", "customer_id", "user_name", "user_email", "category", "reason", "call_booked", "preferred_time", "follow_up_summary", "status", "created_at"],
  conversation_events: ["id", "conversation_id", "event_type", "summary", "metadata", "created_at"],
  evaluations: ["id", "run_id", "scenario_id", "scenario_name", "input", "expected_behavior", "actual_behavior", "tools_called", "answer_type", "passed", "notes", "conversation_id", "created_at"],
  kb_chunks: ["id", "chunk_key", "source_title", "section", "content", "summary", "position", "embedding", "tsv", "updated_at"],
};

let problems = 0;
const fail = (msg: string) => {
  problems++;
  console.log(`✗ ${msg}`);
};

for (const [table, columns] of Object.entries(EXPECTED)) {
  const { error } = await db.from(table).select(columns.join(",")).limit(0);
  if (error) {
    // Narrow down which columns are missing.
    const missing: string[] = [];
    for (const c of columns) {
      const { error: colError } = await db.from(table).select(c).limit(0);
      if (colError) missing.push(c);
    }
    fail(`${table}: ${missing.length === columns.length ? `table missing or unreadable (${error.message})` : `missing columns ${missing.join(", ")}`}`);
    continue;
  }
  const { count } = await db.from(table).select("*", { count: "exact", head: true });
  console.log(`✓ ${table.padEnd(20)} ${columns.length} columns, ${count ?? 0} rows`);
}

const fts = await db.rpc("search_kb_chunks_fts", { query_text: "fees for international payments", match_count: 2 });
if (fts.error) fail(`search_kb_chunks_fts: ${fts.error.message}`);
else console.log(`✓ search_kb_chunks_fts   ${(fts.data as unknown[]).length} results${(fts.data as unknown[]).length ? "" : " (run pnpm kb:ingest)"}`);

const empty = await db.rpc("search_kb_chunks_fts", { query_text: "", match_count: 2 });
if (empty.error) fail(`search_kb_chunks_fts(empty query) errored — re-run migration 003: ${empty.error.message}`);
else console.log("✓ search_kb_chunks_fts   empty query handled");

const zero = `[${new Array(1024).fill(0).join(",")}]`;
const vec = await db.rpc("match_kb_chunks", { query_embedding: zero, match_count: 1 });
if (vec.error) fail(`match_kb_chunks: ${vec.error.message}`);
else console.log("✓ match_kb_chunks        callable (pgvector ok)");

console.log(problems ? `\n${problems} problem(s) found` : "\nDatabase matches the migrations.");
process.exit(problems ? 1 : 0);
