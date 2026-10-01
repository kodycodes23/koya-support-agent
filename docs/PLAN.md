# Koya — Architecture & Build Plan

Koya is a voice-first, first-line support agent for **RelayPay** (B2B cross-border payments for African startups and SMEs).
Source of truth for requirements: `../aat-c3-week-6-support-agent/` (read-only). A byte-identical copy of its `assets/` lives in `./assets/` and is what our scripts read, so this repo is self-contained.

---

## 1. System overview

```
 Browser (apps/web, Next.js + @vapi-ai/web)
   │  WebRTC audio
   ▼
 Vapi  ── STT / TTS / turn-taking / call UI events
   │  (a) POST {AGENT_URL}/chat/completions   OpenAI format, stream=true      Authorization: Bearer VAPI_LLM_SECRET
   │  (b) POST {AGENT_URL}/vapi/webhook       server messages (status-update, end-of-call-report)   x-vapi-secret
   ▼
 apps/agent-server  (Hono on Node)
   ├─ /chat/completions → agent core → SSE chunks (OpenAI chat.completion.chunk)
   ├─ /vapi/webhook     → open/close conversation records
   ├─ agent core: Claude Agent SDK query()
   │     settingSources: []            (no filesystem settings)
   │     tools: []                     (all built-in Claude Code tools disabled)
   │     allowedTools: ['mcp__koya__*'] (only our MCP tools)
   │     mcpServers: { koya: { type:'http', url: MCP_SERVER_URL, headers: { Authorization, x-conversation-id } } }
   │     model: KOYA_MODEL (default claude-haiku-4-5), includePartialMessages: true
   └─ writes conversations + conversation_turns directly to Supabase
   │
   │  MCP Streamable HTTP
   ▼
 packages/mcp-server  (standalone, own Dockerfile)
   ├─ tools: search_knowledge_base, lookup_customer, lookup_transaction, lookup_payout,
   │         create_support_ticket, create_escalation, log_conversation_event
   ├─ every call wrapped → tool_call_logs row (+ retrieval_logs for search)
   ▼
 Supabase Postgres (+ pgvector optional)
   seed: customers, transactions, payouts   runtime: conversations, conversation_turns,
   retrieval_logs, tool_call_logs, support_tickets, escalations, evaluations, kb_chunks
```

### Request lifecycle (one spoken turn)
1. Vapi transcribes speech, then POSTs the whole message history plus a `call` object to `/chat/completions`.
2. The agent server authenticates the bearer secret and upserts `conversations` keyed by `vapi_call_id` (`channel='voice'`).
3. The agent core runs `query()`. It **resumes** the Agent SDK session stored for this call, so earlier tool results (such as identity verification) stay in context. If no session exists, it rebuilds context from the Vapi history.
4. Text deltas stream back as OpenAI SSE chunks while they're generated, so TTS can start on the first sentence. A small leading metadata tag (see §5) is stripped out before streaming.
5. MCP tool calls hit the MCP server, and each one is logged to `tool_call_logs` with the conversation ID taken from the `x-conversation-id` header.
6. At the end of the turn, a `conversation_turns` row is written (user transcript, response, answer_type, confidence note, tools used, latency).
7. When the call ends, Vapi sends `end-of-call-report`. That closes the conversation with `ended_at`, `final_status` (derived from `endedReason` and whether any escalation or ticket exists), and the Vapi `summary`.

Text mode (eval runner, and a `pnpm chat` REPL for dev) calls the same agent core with `channel='text'`. No Vapi is involved.

---

## 2. Packages (pnpm workspace)

| Package | Purpose | Key deps |
| --- | --- | --- |
| `packages/shared` | zod env loader, pino logger, Supabase client factory, DB row types, shared enums (answer types, categories, priorities), text utils (spoken-text sanitiser, redaction) | zod, pino, @supabase/supabase-js |
| `packages/mcp-server` | Standalone MCP server (Express + `StreamableHTTPServerTransport`, stateless: new server/transport per request). `/mcp`, `/health`. Bearer auth. Dockerfile. | @modelcontextprotocol/sdk 1.x |
| `apps/agent-server` | Custom-LLM endpoint, Vapi webhook, agent core, `chat` REPL, eval runner | @anthropic-ai/claude-agent-sdk, hono |
| `apps/web` | Single-screen call page: call button, status, live transcript | next 16, @vapi-ai/web, tailwind 4 |
| `supabase/` | `migrations/*.sql`, `seed/` scripts (TS, run with tsx) | |

The existing create-next-app scaffold at the repo root moves into `apps/web` (together with its `AGENTS.md`, which holds the Next.js 16 rules).

---

## 3. Data model (`supabase/migrations`)

Table names follow the **schema guide** (see §8, D2).

**Seed tables**, with columns exactly as in the CSVs:
- `customers(customer_id PK, company_name, contact_name, contact_email, plan, account_status, region, kyc_status, support_notes)`
- `transactions(transaction_id PK, customer_id FK, transaction_type, amount numeric, currency, destination_country, status, created_at date, estimated_arrival date null, support_summary)`
- `payouts(payout_id PK, transaction_id FK, customer_id FK, recipient_name, amount numeric, currency, status, scheduled_for date, failure_reason null)`
- CHECK constraints on the enumerated values from the guide (plan, account_status, kyc_status, transaction status and type, payout status).

**Runtime tables** (uuid PKs, `created_at timestamptz default now()`):
- `conversations(id, channel voice|text|eval, vapi_call_id unique null, caller_id, verified_customer_id FK null, agent_session_id, started_at, ended_at, final_status, ended_reason, summary, metadata jsonb)`
- `conversation_turns(id, conversation_id FK, turn_index, user_transcript, assistant_response, answer_type answered|clarifying|escalated|declined|lookup, confidence high|medium|low, uncertainty_note, tools_used text[], latency_ms, created_at)`
- `retrieval_logs(id, conversation_id, query, retrieval_mode vector|fts, chunk_ids uuid[], chunks jsonb [{id,title,section,score}], source_title, source_summary, created_at)`
- `tool_call_logs(id, conversation_id, tool_name, purpose, input_summary, result_summary, status success|not_found|error|denied, error_message, duration_ms, created_at)`
- `support_tickets(id, ticket_ref 'TKT-xxxx', conversation_id, customer_id null, transaction_id null, category, priority low|medium|high|urgent, summary, status open|in_progress|closed, created_at)`
- `escalations(id, escalation_ref 'ESC-xxxx', conversation_id, ticket_id null, customer_id null, user_name, user_email, category compliance|account|dispute|payment|other, reason, call_booked bool, preferred_time, follow_up_summary, status open|in_progress|closed, created_at)`
- `conversation_events(id, conversation_id, event_type, summary, metadata jsonb, created_at)`, the target for `log_conversation_event`
- `evaluations(id, run_id, scenario_id, scenario_name, input, expected_behavior, actual_behavior, tools_called text[], answer_type, passed bool, notes, conversation_id, created_at)`
- `kb_chunks(id, source_title, section, content, summary, tsv tsvector generated, embedding vector(1024) null)` with a GIN index on `tsv` and an HNSW index on `embedding`
- RPCs: `match_kb_chunks(query_embedding, match_count)` and `search_kb_chunks_fts(query text, match_count)`. The FTS one uses `websearch_to_tsquery` and `ts_rank_cd`, and falls back to OR-ed terms when the AND query returns nothing.

**Security:** RLS is enabled on every table with no anon policies. Only server components use the service-role key, and the browser never talks to Supabase.

**Scripts:**
- `pnpm db:seed` parses the three CSVs and upserts them idempotently.
- `pnpm kb:ingest` splits `relaypay-knowledge-base.md` on `##`/`###` headings into about 40 chunks. Each chunk gets title, section, content, and a first-sentence summary. It embeds the chunks if `EMBEDDINGS_API_KEY` is set and upserts them.

---

## 4. MCP tools (`packages/mcp-server`)

Every handler goes through `withToolLogging(name, purpose, handler)`, which:
- validates input with zod
- times the call
- writes a `tool_call_logs` row with redacted input and result summaries
- catches every error and returns structured `{ ok:false, error }`, never a stack trace or a secret

Missing records return `{ found:false }` and never throw.

| Tool | Behaviour |
| --- | --- |
| `search_knowledge_base({query, top_k?=4})` | Uses vector search if embeddings are configured, otherwise FTS. Returns `{chunks:[{id, source_title, section, content, score}], mode}` and writes `retrieval_logs`. Not in the spec, but required by your brief and needed for grounding. |
| `lookup_customer({customer_id?, email?, company_name?, contact_name?})` | Spec output plus `verified`. **Verified = at least two independent identifiers match the same record** (e.g. contact name + company for "Amara from LagosLedger"). On verify, sets `conversations.verified_customer_id`. If unverified, returns only `found` and `verified:false` plus which extra factor to ask for. `support_notes` is flagged internal (routing only, never spoken). `contact_name` is an additive input beyond the spec. |
| `lookup_transaction({transaction_id})` | Spec output. `status`, `estimated_arrival`, and `support_summary` are always returned (the caller supplied the reference, as the KB allows). `amount`, `currency`, and `destination_country` are returned only when the conversation is verified as the owning customer; otherwise they come back as `redacted:true`. Adds `escalation_recommended` when the status is `review required` or `failed`, or the summary says "Escalate". |
| `lookup_payout({payout_id?, transaction_id?})` | Spec output, with the same gating for `recipient_name` and `amount`, plus `escalation_recommended` (PAY-7002 → compliance). |
| `create_support_ticket({customer_id?, transaction_id?, category, priority, summary, conversation_id?})` | Inserts into `support_tickets`. `conversation_id` defaults to the header value. Returns `{ticket_id, status:'open'}`. |
| `create_escalation({ticket_id?, customer_id?, user_name, user_email, category, reason, preferred_time?})` | Inserts into `escalations` (`call_booked = !!preferred_time`) and logs a `conversation_events` row. Returns `{escalation_id, status:'open', follow_up_summary}`. Validates the email format. |
| `log_conversation_event({conversation_id?, event_type, summary, metadata})` | Inserts into `conversation_events`. Returns `{logged:true}`. |

"Log helpers" means `log_conversation_event` plus the automatic `tool_call_logs` and `retrieval_logs` logging. Turn and conversation logging stays deterministic in the agent server rather than depending on the model.

---

## 5. Agent core & system prompt (`apps/agent-server/src/agent`)

The system prompt is kept short for latency. It sets out:
- **Persona:** Koya, RelayPay's voice support agent. Calm and professional.
- **Voice output rules:** 1 to 3 sentences, no markdown, lists, or URLs. Say numbers and currencies naturally ("two thousand four hundred US dollars", "August nineteenth"). Never read IDs character by character unless the caller asks.
- **Decision paths** (from support-decision-rules): answer, clarify (ONE question, e.g. incoming transfer vs outgoing payout vs invoice payment, then ask for the reference), escalate, or decline.
- **Grounding:** always call `search_knowledge_base` before any product or policy answer, and answer only from the returned chunks. If the chunks don't cover it, say so and offer a ticket or callback.
- **Identity:** verify with `lookup_customer` (two identifiers) before discussing account details. Never speak balances, full account details, contact emails, internal notes, or compliance reasoning.
- **Lookups:** never guess a status. Quote the customer-safe summary and never promise an arrival time beyond the record ("expected around", not "will arrive").
- **Escalation triggers:** compliance/KYC, disputes, account restrictions, refunds, cancellations, frustration or urgency, and `escalation_recommended` records. Say a specialist is needed, collect name, email, and preferred callback time, call `create_escalation`, confirm follow-up, then stop troubleshooting.
- **Ticket path:** non-urgent issues that need follow-up (e.g. a failed invoice payment) go to `create_support_ticket`.
- **Metadata tag:** every reply starts with `<koya type="answered|clarifying|escalated|declined|lookup" confidence="high|medium|low" note="…"/>`. The server strips it from the stream and stores it on the turn. If it's missing, the server falls back to heuristics based on which tools were called.

Runtime safeguards:
- `maxTurns` is capped (default 8).
- A per-turn timeout returns a spoken apology.
- An output sanitiser strips any stray markdown or URLs before SSE.
- The session ID is stored per conversation for `resume`.

---

## 6. Webhook (`POST /vapi/webhook`)
- Verifies the `x-vapi-secret` header.
- `status-update` with `in-progress` upserts the conversation and sets `started_at`. With `ended`, it sets `ended_at` if that's still missing.
- `end-of-call-report` sets `ended_at`, `ended_reason`, and `summary` (`analysis.summary`, or `summary`). `final_status` is `escalated` if an escalation exists, `ticket_created` if a ticket exists, `completed` for a normal end, and `abandoned`/`error` otherwise.
- Other message types return 200 and are ignored.

## 7. Evaluation runner (`pnpm eval`)
- Scenarios 1–8 are encoded as scripted conversations in `apps/agent-server/src/eval/scenarios.ts`. Scenarios 6 and 7 get follow-up user turns that supply the reference, name, email, and callback time.
- Each scenario runs through the agent core in text mode (`channel='eval'`).
- Deterministic checks: required tools called, forbidden tools not called, `answer_type`, and a DB record exists (ticket or escalation).
- Safety checks: no digits of amounts spoken for unverified callers, no "guarantee", no URLs or markdown.
- (Dropped during build: the optional LLM judge. Deterministic checks cover every expected-behaviour bullet, and full transcripts are saved in the evidence doc for human review.)
- Results go to `evaluations` and to `docs/TESTING_EVIDENCE.md`.
- Scenario 9 (voice) is a manual row that you fill in after a real Vapi call; the runner leaves a placeholder with instructions.

---

## 8. Decisions & deviations — please confirm

| # | Topic | Proposal |
| --- | --- | --- |
| D1 | Ticket tool name | ✅ Decided: spec name `create_support_ticket`. |
| D2 | Table names | ✅ Decided: schema-guide names (`conversation_turns`, `support_tickets`), except the tool-call table is **`tool_call_logs`** (not the guide's `tool_calls`), because the Supabase project already has an unrelated `tool_calls` table. |
| D3 | Escalation rules say to escalate "specific transaction" questions, but Scenario 4 expects a lookup | Look up first and give the safe summary. Escalate when the record is review required or failed, or the caller wants more than the record shows. |
| D4 | Identity verification | ✅ Accepted for now: two matching identifiers out of customer_id, contact_email, company_name, and contact_name, enforced in the MCP server (redaction). |
| D5 | Embeddings provider | ✅ Decided: no vendor was mandated, so it's provider-agnostic. `EMBEDDINGS_PROVIDER=openai\|voyage` + `EMBEDDINGS_API_KEY`, both pinned to 1024 dims. No key means Postgres full-text search. |
| D6 | Per-turn answer_type | Leading metadata tag that is stripped from the stream, with heuristic fallback. |
| D7 | Conversation continuity | Agent SDK `resume` per call. This is fine for a single instance; the fallback rebuilds context from the Vapi history. |
| D8 | HTTP framework | Hono (agent server) and Express (MCP server, the transport's documented pairing). |
| D11 | Tool-call log table | ✅ `tool_call_logs`, because the Supabase project already had an unrelated `tool_calls` table. |
| D9 | Testing evidence table format | ✅ For now: derived from the PRD's testing section and the expected behaviours in test-scenarios.md. You'll supply the exact project-page format at the end. |
| D10 | Tooling | pnpm isn't installed, so I'll enable it via `corepack enable`. The Supabase CLI and ngrok aren't installed either: migrations can be applied with `supabase db push` or pasted into the SQL editor, and ngrok is only needed for Vapi. |

---

## 9. Phased build plan

Each phase ends with a verification step. I'll pause at ★ for your credentials or a check.

| Phase | Work | Done when |
| --- | --- | --- |
| **0. Workspace** | corepack/pnpm, `pnpm-workspace.yaml`, root `tsconfig.base.json`, move the scaffold into `apps/web`, skeletons for all packages, `packages/shared` (env/zod, logger, supabase, types), `.env.example` files, lint/typecheck scripts | `pnpm -r typecheck` passes |
| **1. Database** ★ | Migrations (schema, RLS, pgvector, FTS, RPCs), `db:seed`, `kb:ingest` | You apply the migrations; `pnpm db:seed && pnpm kb:ingest` reports 5 customers, 5 transactions, 3 payouts, and about 40 chunks; FTS returns the fees chunk for "fees international payments" |
| **2. MCP server** | All 7 tools, logging wrapper, redaction, auth, `/health`, Dockerfile, `pnpm mcp:smoke` (MCP client script) | The smoke script exercises every tool (found and not-found paths) and `tool_call_logs` rows appear |
| **3. Agent server** | Agent core, system prompt, `/chat/completions` SSE (stream and non-stream), turn logging, `pnpm chat` REPL | `curl -N` streams valid SSE; the REPL handles scenarios 1–4 sensibly |
| **4. Webhook** | `/vapi/webhook` handlers and final-status logic | Replaying fixture payloads closes a conversation row |
| **5. Evals** | Scenario scripts, checks, optional judge, evidence generator | `pnpm eval` writes 8 `evaluations` rows and `docs/TESTING_EVIDENCE.md` |
| **6. Web app** | Brand-compliant call page (deep blue/teal, off-white, Inter, no gradients or emoji), call button, status pill, live transcript, mute | Builds; you can start a call once Vapi is configured |
| **7. Vapi wiring** ★ | `pnpm vapi:sync` creates or updates the assistant through the Vapi API (custom-llm provider, server URL, voice, transcriber, first message), plus an ngrok guide | A real voice call works end to end and logs appear in Supabase |
| **8. Docs** | `README.md`, `docs/HOW_IT_WORKS.md`, final `TESTING_EVIDENCE.md` with the scenario 9 row | Docs are complete |

## 10. Risks
- **Latency:** the Agent SDK starts a Claude Code subprocess per `query()`, which adds roughly one to two seconds. Mitigations: Haiku, a short prompt, partial-message streaming, and optional pre-warming. If it's still too slow, the measured numbers go in the Phase 3 checkpoint.
- **Vapi custom-LLM format:** Vapi expects OpenAI chunk shape and `data: [DONE]`. This is covered by an SSE contract test.
- **Session files are local:** `resume` needs a single agent-server instance, or the fallback path.
- **The model skipping retrieval:** enforced by the prompt, and the eval checks that `search_knowledge_base` was called for policy scenarios.

## 11. Env vars (validated with zod per app)
- `packages/mcp-server`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_PORT=8787`, `MCP_AUTH_TOKEN`, `EMBEDDINGS_PROVIDER`, `EMBEDDINGS_API_KEY?`, `EMBEDDINGS_MODEL?`, `LOG_LEVEL`
- `apps/agent-server`: `ANTHROPIC_API_KEY`, `KOYA_MODEL=claude-haiku-4-5`, `AGENT_MAX_TURNS=8`, `AGENT_TURN_TIMEOUT_MS=25000`, `PORT=8080`, `MCP_SERVER_URL`, `MCP_AUTH_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPI_LLM_SECRET`, `VAPI_WEBHOOK_SECRET`, `EVAL_JUDGE?`, `LOG_LEVEL`
- `apps/web`: `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `NEXT_PUBLIC_VAPI_ASSISTANT_ID`
- Vapi / scripts: `VAPI_API_KEY` (Vapi private API key, server-side only), `PUBLIC_AGENT_URL` (ngrok URL)

## 12. Build status (2026-09-28)

| Phase | Status |
| --- | --- |
| 0 Workspace | ✅ Done |
| 1 Database | ✅ Migrations applied to the live project, `db:verify` clean, seed and KB (37 chunks) loaded |
| 2 MCP server | ✅ 18 tests pass; live `mcp:smoke` passes |
| 3 Agent server | ✅ SSE `/chat/completions` verified with curl; the REPL works |
| 4 Webhook | ✅ status-update and end-of-call-report close conversations (verified with replayed payloads) |
| 5 Evals | ✅ 8/8 scenarios pass (run `c8eab086`); `docs/TESTING_EVIDENCE.md` generated |
| 6 Web app | ✅ Builds and lints; desktop layout checked by screenshot |
| 7 Vapi wiring | ⏳ `vapi:sync` written and dry-run tested; needs ngrok, the public key and a live call |
| 8 Docs | ✅ README and HOW_IT_WORKS written; scenario 9 row pending the live call |

Measured latency after tuning (Haiku 4.5, thinking off, warm process, 2026-09-28): the first words leave the server after about 0.9–1.3 s, and a full answer that uses a tool completes in about 3.6–4.2 s. That's down from 4.3–5.7 s before any words on real calls. The biggest wins were disabling the runtime's default extended thinking (0.7–2.5 s per model call), pre-warming the next turn's process (0.3–0.7 s), and dropping the leading metadata tag. Vapi now uses model-based end-of-turn detection (`livekit`), with longer waits after Koya asks for an email or reference and while the caller is spelling. A fixed 0.8 s silence timer, tried first, cut callers off mid-spelling. A full tool-using turn takes about 6–8 s. The main costs are model time-to-first-token (about 1.2 s per model call) and around 150 ms per Supabase round trip. Audit writes run in the background, so they don't add to it. If more speed is needed next: prewarm the Agent SDK process (`prewarm()`, alpha), host Supabase closer to the agent server, or add a second Haiku-only route for no-tool turns.
