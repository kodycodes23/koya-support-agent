# Koya: voice support agent for RelayPay

Koya is a first-line voice support agent for RelayPay, a B2B cross-border payments product. A caller talks to Koya in the browser. Koya answers from the approved knowledge base, looks up customers, transactions and payouts, creates tickets and escalations, and logs everything to Supabase.

```
Browser (apps/web) ──WebRTC──▶ Vapi (speech-to-text, text-to-speech)
                                 │  POST /chat/completions  (Custom LLM, streamed SSE)
                                 │  POST /vapi/webhook      (status-update, end-of-call-report)
                                 ▼
                     apps/agent-server (Claude Agent SDK)
                                 │  MCP over Streamable HTTP
                                 ▼
                     packages/mcp-server (7 support tools) ──▶ Supabase Postgres
```

For a one-page explanation, see [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md). The design and decisions are in [docs/PLAN.md](docs/PLAN.md), and test results are in [docs/TESTING_EVIDENCE.md](docs/TESTING_EVIDENCE.md).

| Package | What it is |
| --- | --- |
| `packages/mcp-server` | Standalone MCP server with the tools `search_knowledge_base`, `lookup_customer`, `lookup_transaction`, `lookup_payout`, `create_support_ticket`, `create_escalation` and `log_conversation_event`. Every call is logged to `tool_call_logs`. |
| `apps/agent-server` | OpenAI-compatible `POST /chat/completions` (SSE) for Vapi, the Vapi webhook, the agent (Claude Agent SDK), the text REPL and the eval runner. |
| `apps/web` | Next.js call page with a call button, call status and live transcript (`@vapi-ai/web`). |
| `packages/shared` | Env validation (zod), logger, Supabase client and shared types. |
| `supabase/` | SQL migrations, seed script, knowledge-base ingest and DB verification. |

---

## 1. Prerequisites

- Node.js 22 or later, and pnpm through Corepack: `corepack enable`
- A [Supabase](https://supabase.com) project (the free tier is fine)
- An [Anthropic API key](https://console.anthropic.com), under API Keys
- A [Vapi](https://vapi.ai) account. You need both the **private** and **public** API keys (Dashboard → API Keys).
- [ngrok](https://ngrok.com) with a free account, so Vapi can reach your local backend

```bash
pnpm install
cp .env.example .env
```

## 2. Environment variables

Every package loads its own `.env` first, then the root `.env`. For local development, the root file is enough. Each deployable package also has its own `.env.example` listing only what it needs. All variables are validated with zod at startup, and a missing or malformed value stops the process with a clear message.

| Variable | Used by | Where it comes from |
| --- | --- | --- |
| `SUPABASE_URL` | all servers | Supabase → Project Settings → Data API → Project URL. If you paste the REST URL ending in `/rest/v1/`, the extra path is stripped automatically. |
| `SUPABASE_SERVICE_ROLE_KEY` | all servers | Supabase → Project Settings → API Keys → `service_role` (or the `sb_secret_…` key). Server-only. **Not** the anon key, because RLS gives the anon key no access. |
| `ANTHROPIC_API_KEY` | agent-server | console.anthropic.com → API Keys |
| `KOYA_MODEL` | agent-server | Defaults to `claude-haiku-4-5`, a fast model for voice. Set `claude-sonnet-5` if you prefer quality over speed. |
| `AGENT_THINKING` | agent-server | `off` (default: first words in about 1–2 s, 16/16 eval scenarios), `light` (1,024-token budget, but it spent 3.5–9 s thinking on real calls), or `adaptive` (required for models that can't disable thinking). |
| `MCP_SERVER_URL` / `MCP_AUTH_TOKEN` | agent-server, mcp-server | Defaults to `http://localhost:8787/mcp`. The token is any long random string, shared by both servers. |
| `VAPI_LLM_SECRET` | agent-server, `vapi:sync` | Random string. Vapi sends it as a Bearer token on `/chat/completions`. |
| `VAPI_WEBHOOK_SECRET` | agent-server, `vapi:sync` | Random string. Vapi sends it as `x-vapi-secret` on `/vapi/webhook`. |
| `VAPI_API_KEY` | `vapi:sync` | Vapi **private** key |
| `PUBLIC_AGENT_URL` | `vapi:sync` | Your public https URL, for example from ngrok |
| `EMBEDDINGS_PROVIDER` / `EMBEDDINGS_API_KEY` | ingest, mcp-server | Optional. Use `openai` or `voyage` for vector search. Leave the key blank to use Postgres full-text search. |
| `NEXT_PUBLIC_VAPI_PUBLIC_KEY` / `NEXT_PUBLIC_VAPI_ASSISTANT_ID` | web, in `apps/web/.env.local` | Vapi **public** key, and the assistant ID printed by `pnpm vapi:sync` |
| `RESEND_API_KEY` / `SUPPORT_TEAM_EMAIL` / `EMAIL_FROM` | mcp-server and web | Support-team email for every escalation and callback request (Resend). With Resend's free plan, `SUPPORT_TEAM_EMAIL` must be your own Resend account address and `EMAIL_FROM` stays `onboarding@resend.dev`. Leave the key empty to turn emails off. |
| `REQUIRE_SIGNED_IN_CALLER` | agent-server | `true` (default): voice calls without a valid signed-in token get a fixed "please sign in" reply and the agent never runs. Set `false` to allow anonymous callers, who then verify by voice. The Vapi dashboard's "Talk to Assistant" button only works with `false`. |
| `KOYA_IDENTITY_SECRET` | web and agent-server (same value) | Signs the "signed-in caller" token the browser passes to Koya (`openssl rand -hex 32`). Leave empty to turn the feature off; callers then verify by voice. |
| `SESSION_SECRET` | web (sign-in) | Random 32+ character string that signs the session cookie (`openssl rand -hex 32`). Required in production; local dev falls back to a fixed dev key. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | web (sign-in, dashboard, `/api/callback`) | Used by the "Prefer a callback?" form to create an `escalations` row. Locally they're read from the root `.env`. When the web app is deployed, set them as server-only environment variables, never as `NEXT_PUBLIC_*`. |

To generate a random secret: `openssl rand -hex 32`.

## 3. Supabase setup

1. In the Supabase **SQL Editor**, run the files in [`supabase/migrations/`](supabase/migrations) in filename order, or run `supabase db push` if you use the Supabase CLI. They create the seed tables, the runtime tables, the knowledge-base chunks with their search functions (pgvector is enabled), and RLS on every table.
2. Check the database, then load the data:

```bash
pnpm db:verify   # read-only: checks every table and column the code uses, plus the search functions
pnpm db:seed     # loads assets/seed-data/*.csv: 5 customers, 5 transactions, 3 payouts (idempotent)
pnpm kb:ingest   # chunks assets/relaypay-knowledge-base.md into kb_chunks (37 chunks)
```

The tables are `customers`, `transactions`, `payouts`, `conversations`, `conversation_turns`, `retrieval_logs`, `tool_call_logs`, `support_tickets`, `escalations`, `conversation_events`, `evaluations` and `kb_chunks`.

## 4. Run the MCP server

```bash
pnpm mcp:dev     # http://localhost:8787/mcp   (GET /health lists the tools)
pnpm mcp:smoke   # in a second terminal: calls every tool against the live DB and checks the logs
```

The server is stateless (Streamable HTTP, JSON responses) and requires `Authorization: Bearer $MCP_AUTH_TOKEN` when the token is set. The token is mandatory when `NODE_ENV=production`. The agent passes the conversation ID in the `x-conversation-id` header, so every `tool_call_logs` and `retrieval_logs` row is linked to its conversation.

**Deploying it on its own:** there's a Dockerfile at [`packages/mcp-server/Dockerfile`](packages/mcp-server/Dockerfile). Build it from the repo root with `docker build -f packages/mcp-server/Dockerfile -t koya-mcp .`, then run it with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_AUTH_TOKEN` and `PORT`. Without Docker, `pnpm --filter @koya/mcp-server build && node packages/mcp-server/dist/index.js` works on any Node host. (The Dockerfile hasn't been build-tested yet.)

## 5. Run the agent server

```bash
pnpm agent:dev   # http://localhost:8080  (POST /chat/completions, POST /vapi/webhook, GET /health)
```

To try the agent in text mode without voice (the MCP server must be running):

```bash
pnpm chat                                            # interactive
pnpm chat "My payment is stuck." "It's an outgoing payout"   # scripted turns
```

Each reply prints its answer type, the tools used and the latency.

To test the Vapi endpoint directly:

```bash
curl -N http://localhost:8080/chat/completions \
  -H "Authorization: Bearer $VAPI_LLM_SECRET" -H "Content-Type: application/json" \
  -d '{"stream":true,"call":{"id":"local-test"},"messages":[{"role":"user","content":"What fees does RelayPay charge?"}]}'
```

The agent uses the Claude Agent SDK with no filesystem settings (`settingSources: []`), every built-in Claude Code tool disabled (`tools: []`), and only the seven MCP tools allowed.

## 6. Run the evaluations

```bash
pnpm eval              # runs scenarios 1–8 from assets/test-scenarios.md plus 11–13 (out of scope, prompt injection, harmful request), writes the evaluations table and docs/TESTING_EVIDENCE.md
pnpm eval --only 3,6   # a subset (doesn't rewrite the evidence doc)
```

On a laptop, keep the machine awake during long runs, for example with `caffeinate -i pnpm eval` on macOS. Idle sleep in the middle of a run shows up as timeouts that aren't real.

## 7. Expose the backend with ngrok

Vapi runs in the cloud, so it needs a public https URL for the agent server.

```bash
brew install ngrok               # or download it from ngrok.com
ngrok config add-authtoken <your-ngrok-authtoken>   # ngrok dashboard → Your Authtoken
ngrok http 8080
```

Copy the `https://….ngrok-free.app` forwarding URL into `PUBLIC_AGENT_URL` in `.env`. The free ngrok URL changes every time you restart it, so re-run `pnpm vapi:sync` after each restart. Alternatively, `cloudflared tunnel --url http://localhost:8080` gives a temporary URL with no account needed.

## 8. Configure the Vapi assistant

**Recommended:** with the agent server and ngrok both running:

```bash
pnpm vapi:sync             # creates or updates the "Koya - RelayPay Support" assistant and its custom-llm credential
pnpm vapi:sync --dry-run   # shows the payload without sending it
```

The script prints the assistant ID. It configures:
- **Model:** provider *Custom LLM*, URL = `PUBLIC_AGENT_URL`. Vapi calls `{url}/chat/completions`.
- **Credential:** a *custom-llm* credential whose API key is `VAPI_LLM_SECRET`, sent as a Bearer token.
- **Server URL:** `PUBLIC_AGENT_URL/vapi/webhook`, with the header `x-vapi-secret: VAPI_WEBHOOK_SECRET`. Server messages: `status-update` and `end-of-call-report`.
- **Voice and transcriber:** Vapi voice `Clara` (override with `VAPI_VOICE_ID`) and Deepgram `nova-3`, English.

**Manual alternative (dashboard):** Create Assistant → Model: provider **Custom LLM**, set the URL to your ngrok URL and the model name to `koya`. Add a **Custom LLM** credential under Credentials with `VAPI_LLM_SECRET` as its API key. Under Advanced → Server URL, set `…/vapi/webhook` with the header `x-vapi-secret`, and enable the *status-update* and *end-of-call-report* messages.

## 9. Run the web app

```bash
cp apps/web/.env.example apps/web/.env.local   # add the public key and assistant ID
pnpm web:dev                                    # http://localhost:3000 (dashboard) · /support (voice assistant)
```

Open http://localhost:3000/support (or click **Help & support** on the dashboard), then click **Speak with Koya** (or the microphone in the centre of the orb), allow the microphone, and ask a question. The orb rotates during the call and responds to Koya's voice, the status line shows *Listening* or *Koya is speaking*, and the transcript updates live. Below the call area, **Prefer a callback?** lets visitors request a specialist callback, which creates an `escalations` record. When the call ends, the webhook closes the `conversations` row with its end time, final status and Vapi's summary.

**Sign in:** http://localhost:3000 opens the sign-in page (every link and redirect is relative, so the same applies on any deployed domain). Sign in as any seed customer with their **email or first name** and the password **first name + 123**, for example `amara` / `amara123` or `daniel@nairobiops.example` / `daniel123`. The page lists the demo accounts; set `DEMO_LOGIN_HINTS=0` to hide them. Sessions are a signed, HTTP-only cookie (`SESSION_SECRET`), and **Log out** is in the dashboard header.

**Dashboard:** after sign-in, `/dashboard` is a business dashboard built from that customer's real Supabase records: company, plan, account and KYC status, transactions and payouts. Restricted or unverified accounts show a notice with Talk to Koya and callback buttons. Its **Help & support** button, the floating **Help** button, the self-service card and each in-progress payment's **Ask Koya** link all open the voice assistant at **/support**, which, like the callback form's API, is available only to signed-in customers (signed-out visitors are sent to sign-in). The voice assistant page has a Dashboard link back. Signed-out visitors to `/dashboard` are sent to sign-in; signed-in visitors to `/` go straight to their dashboard. Activity rows are the customer's real references (for example TXN-9001 and PAY-7001 for Amara), so Koya's lookups match what the dashboard shows. Balances and invoices are demo figures, in USD, EUR and the customer's local currency.

**Signed-in callers:** when a signed-in customer starts a call from `/support`, the web server issues a 5-minute signed token (HS256, `KOYA_IDENTITY_SECRET`), which the browser attaches to the Vapi call as metadata. The agent server checks the signature, issuer, audience and expiry, sets `conversations.verified_customer_id`, logs a `caller_signed_in` event, and briefs Koya in a system line the caller can't fake. Koya then skips voice verification. `lookup_customer` returns the customer's recent transactions and payouts, so "what's happening with my payout?" needs no reference. `create_escalation` fills in the name and email from the account instead of asking for them. A missing, expired or forged token means the call is treated as anonymous. With `REQUIRE_SIGNED_IN_CALLER=true` (the default), Koya then only asks the caller to sign in first; the agent never runs, and the rejection is logged as an `unauthenticated_call_rejected` event.

**Support-team emails:** each new escalation (Koya escalating a call, or booking a callback during one) and each callback request from the form sends a branded notification to `SUPPORT_TEAM_EMAIL` through Resend. It contains the reference, reason, customer, contact email, category, preferred callback time and source. Emails go out after the record is saved and never delay Koya or the form; a failed send is logged and the escalation is still recorded. The template is in `packages/shared/src/email.ts`.

**Voice test (scenario 9):** after a call, find it in Supabase with `select * from conversations where channel = 'voice' order by started_at desc limit 1;`, then check its `conversation_turns`, `tool_call_logs` and `retrieval_logs`. Record the result in row 9 of `docs/TESTING_EVIDENCE.md`.

---

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm typecheck` / `pnpm test` | Typecheck and unit/integration tests for all packages |
| `pnpm db:verify` / `db:seed` / `kb:ingest` | Database check, seed data, knowledge-base chunks |
| `pnpm mcp:dev` / `mcp:smoke` | Run the MCP server, and smoke-test every tool against the live DB |
| `pnpm agent:dev` / `chat` / `eval` | Agent server, text REPL, evaluation runner |
| `pnpm vapi:sync` | Create or update the Vapi assistant |
| `pnpm web:dev` | Web call page |

## Troubleshooting

- **`Invalid path specified in request URL`** from Supabase: the URL ended in `/rest/v1/`. The config now strips that path automatically, so this should no longer happen.
- **`column "conversation_id" does not exist`** during migrations: an older table with the same name already exists. This project uses `tool_call_logs` for exactly that reason. Check any other conflicting table with the `db:verify` output.
- **The call connects but Koya is silent:** the ngrok URL changed or the agent server isn't running. Check `PUBLIC_AGENT_URL/health`, then re-run `pnpm vapi:sync`. The agent server logs show `401` if the credential doesn't match `VAPI_LLM_SECRET`.
- **Slow replies:** every turn is logged with a stage timeline (`stages` in the agent server log: warm or cold start, each model call, each tool call, first spoken text). The biggest levers are `AGENT_THINKING=off`, the warm process pool (on by default), and Vapi's endpointing settings in `pnpm vapi:sync`. `scripts/latency-compare.ts` compares the Agent SDK path with a direct API call.
