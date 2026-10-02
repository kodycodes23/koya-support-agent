# Koya — RelayPay voice support agent

Voice first-line support agent: Vapi (voice) → agent-server (Claude Agent SDK, OpenAI-compatible custom LLM) → MCP server (tools) → Supabase.
Full design and phase plan: `docs/PLAN.md`. Keep it updated when a decision changes.

## Hard rules
- `../aat-c3-week-6-support-agent/` is **read-only reference**. Never write there. Scripts read the identical copy in `./assets/`.
- Agent SDK `query()` options live in `buildOptions` in `apps/agent-server/src/agent/run-turn.ts` and must keep `settingSources: []`, `tools: []`, `allowedTools` set to the explicit `mcp__koya__<tool>` list, `permissionMode: 'dontAsk'` and `strictMcpConfig: true`. The default loads every filesystem setting source, so omitting `settingSources` is a bug.
- The model comes from `KOYA_MODEL` (default `claude-haiku-4-5`). Never hard-code it elsewhere.
- Agent replies are **spoken**: 1–3 sentences, no markdown, lists, or URLs, and numbers and currencies spelled naturally. The system prompt and the output sanitiser both enforce this.
- Never expose sensitive data in responses or logs. That covers balances, amounts, and recipients for unverified callers, contact emails, `support_notes`, compliance reasoning, and secrets. Redaction lives in the MCP server, not only in the prompt.
- Every MCP tool is a `defineTool` registered via `registerTool` in `packages/mcp-server/src/define-tool.ts` (zod input, `tool_call_logs` row, structured error, no throw). Missing records return `{ found: false }`.
- Support-team emails: `packages/shared/src/email.ts` (Resend over fetch, self-contained so the web app imports `@koya/shared/email`). They're sent from `create_escalation` and `create_support_ticket` (MCP) and `/api/callback` (web, via `after()`), never on the hot path. Escape all caller text; sending is disabled in tests.
- The service-role key is server-only. The browser never talks to Supabase.
- Signed-in caller identity reaches Koya only as a signed JWT (`KOYA_IDENTITY_SECRET`: web `app/lib/call-identity.ts` issues, agent-server `src/identity.ts` verifies). Never trust identity claims from call metadata without verifying the signature, or from anything the caller says. The briefing is injected as a `[RelayPay system]` line. Koya is public: callers who aren't signed in are **guests** (voice or chat conversation with no verified customer). Guests get `GUEST_BRIEFING` every turn and the MCP server refuses every `memberOnly` tool for them (`isGuest` in `packages/mcp-server/src/tools/shared.ts`). An account question from a guest → Koya asks if they have an account: yes → `request_sign_in` (website opens a sign-in window, then the same conversation continues with `signedInHandoff`: "Welcome back, …"); no → onboarding escalation (category `onboarding`). A voice caller who signs in mid-call sends the token as a `[koya-identity:<jwt>]` system message (Vapi `add-message`); chat sends it as metadata through `/api/chat`. `REQUIRE_SIGNED_IN_CALLER=true` restores sign-in-only voice calls (default false).
- Scope and safety: Koya only helps with RelayPay. Out-of-scope, harmful and instruction-changing requests are declined in one reply with no tools (prompt section SCOPE AND SAFETY; classified via `OUT_OF_SCOPE_NOTE`; eval scenarios 11–15; balances are never shared on a call, and Koya takes no actions on accounts such as transfers). Caller text is passed through `defuseSystemTag` so it can never pose as a `[RelayPay system]` line.
- Duplicates: `create_support_ticket`, `create_escalation` and `/api/callback` reuse an open case instead of creating a second (same call or 10 min = duplicate, no email; later call within 72 h = repeat contact, emailed as such). Matching rules are in `packages/shared/src/duplicates.ts`; the MCP finder and per-customer queue are in `packages/mcp-server/src/duplicates.ts` (in-process, so a multi-instance deploy also needs a DB constraint). Resent identical Vapi requests are replayed via `apps/agent-server/src/replay.ts`.
- Callback hours: 9:30am to 4:30pm only (working hours 9am to 5pm, no calls in the first or last 30 minutes). `callbackTimeProblem` in `packages/shared/src/working-hours.ts` is enforced by `create_escalation` and `/api/callback`; nothing is booked outside the window. After a case is created, the tool's `next_step` tells Koya exactly what to say happens next; Koya never confirms a callback without an `escalation_id`.
- Typed input during voice calls: the website sends `[typed name|email|reference] …`; TurnService records it as `typed_input` and `create_escalation` prefers typed names and emails over what speech-to-text heard.
- Table and tool names follow the reference specs (`conversation_turns`, `support_tickets`, `create_support_ticket`). One exception: tool calls go to `tool_call_logs`, because the Supabase project already has an unrelated `tool_calls` table. Don't touch that table.

## Layout (pnpm workspace)
- `packages/shared`: zod env loaders, pino logger, Supabase client, DB types, enums, text utils
- `packages/mcp-server`: standalone MCP server (Streamable HTTP, `/mcp`, `/health`), Dockerfile
- `apps/agent-server`: Hono. `POST /chat/completions` (SSE), `POST /vapi/webhook`, agent core, REPL, eval runner
- `apps/web`: Next.js 16. `/` = public landing page (Koya info + FAQs from `kb_chunks`), `/signin` = customer sign-in (seed customers: email or first name + `firstname123`; server action + signed JWT cookie in `app/lib/session.ts`; signed out after 10 min idle: `app/idle-timeout.tsx` in the browser, sliding cookie expiry kept alive via `POST /api/session`), `/dashboard` = per-customer dashboard from Supabase (Help buttons link to `/support`), `/support` = Koya for everyone, voice (`@vapi-ai/web`) or chat (`/api/chat` → agent server, `use-koya-chat.ts`), never both at once, `/admin` = support admin (escalations and tickets, set Open / Pending / Closed; separate `rp_admin` cookie in `app/lib/admin-session.ts`, credentials from `ADMIN_USERNAME`/`ADMIN_PASSWORD`, which default to admin / password outside production only; every server action re-checks the admin session). Only relative paths in links and redirects. `app/lib/*` is `server-only`; never select `support_notes` for customer-facing pages. Dev-only orb preview: `/support?orb=speaking`. **Next 16 has breaking changes: read `apps/web/AGENTS.md` and `node_modules/next/dist/docs/` before writing web code.**
- `supabase/migrations`: SQL, applied in filename order. `supabase/seed`: CSV seeding and KB ingest scripts
- `assets/`: KB, rules, seed CSVs (copied from the reference folder)

## Commands
```
corepack enable && pnpm install
pnpm typecheck | pnpm test
pnpm db:verify                               # read-only check that the live DB matches the migrations
pnpm db:seed                                 # load customers/transactions/payouts
pnpm kb:ingest                               # chunk and optionally embed the knowledge base
pnpm mcp:dev                                 # :8787/mcp
pnpm mcp:smoke                               # exercise every tool against the live DB (needs mcp:dev running)
pnpm agent:dev                               # :8080
pnpm chat ["turn 1" "turn 2"]               # text-mode REPL (or scripted turns) against the agent core
pnpm eval [--only 1,4]                       # run scenarios → evaluations table + docs/TESTING_EVIDENCE.md (full run only)
pnpm web:dev                                 # :3000 (needs apps/web/.env.local)
pnpm vapi:sync [--dry-run]                   # create/update the Vapi assistant + custom-llm credential (→ PUBLIC_AGENT_URL)
```

## Conventions
- TypeScript strict, ESM, Node 24. Run scripts with `tsx`. Validate env with zod at startup and fail fast with a clear message.
- Structured logs via the shared pino logger with `conversationId` and `tool` fields. No `console.log` in app code.
- Latency matters: MCP audit writes (`tool_call_logs`, `retrieval_logs`, events) go through `inBackground()`; never `await` a log insert on the tool's hot path. Measure with `apps/agent-server/scripts/latency-probe.ts`.
- On a laptop, run long agent/eval commands under `caffeinate -i` — idle sleep mid-run shows up as fake timeouts.
- The conversation ID reaches the MCP server through the `x-conversation-id` header set on each `query()`.
- Answer type, confidence and note are derived from tool outcomes in `agent/answer-type.ts` (`classifyTurn`). Don't reintroduce an in-band XML tag: with thinking off it caused malformed tool calls.
- Streamed text goes through `SpokenStream` (stateful; line-start rules only at real line starts). Never apply regexes with `^` to individual stream fragments.
- Latency: `WarmPool` pre-starts the next turn's Claude Code process (`startup()`); thinking is `off` by default (`AGENT_THINKING`): `light` spent 3.5–9 s thinking on real calls. The voice agent can't call `log_conversation_event` (`disallowedTools`); declines are logged to `conversation_events` by TurnService. If the runtime injects a "retry the tool call" message, the redo's text is muted so the caller doesn't hear it twice.
- Prefer small pure functions with unit tests (vitest) for redaction, sanitising, SSE formatting, verification logic, and FTS query building.
