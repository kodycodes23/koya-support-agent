# How Koya works

Koya is RelayPay's voice support agent. A customer opens the support page, clicks **Start call** and talks. Koya answers out loud, checks their records when that's safe, and hands the case to a human when it should.

## What happens during a call

1. **The customer speaks.** From the dashboard, the customer taps **Help** and lands on the voice page (`/support` in `apps/web`), which connects the microphone to **Vapi**, which converts speech to text.
2. **Vapi asks our backend what to say.** Vapi is set up with a "Custom LLM", so each time the caller finishes speaking it sends the conversation to our agent server's `/chat/completions` endpoint.
3. **The agent decides.** The agent server runs **Claude** through the Claude Agent SDK, with Koya's support rules as its system prompt. Its only abilities are the seven tools on our MCP server; every built-in tool is switched off. Each turn it picks one path:
   - **Answer:** it searches the approved knowledge base and answers only from what it finds.
   - **Clarify:** a vague request ("my payment is stuck") gets one question back first.
   - **Look up:** it checks a customer, transaction or payout in the database instead of guessing.
   - **Escalate or ticket:** compliance, disputes, refunds, cancellations, restrictions or an upset caller lead to an escalation with callback details. Other follow-ups become a support ticket.
   - **Decline:** if the knowledge base doesn't cover a question, Koya says it can't answer confidently and offers a ticket or callback.
   - **Stay in scope:** questions that have nothing to do with RelayPay get a polite redirect. Harmful requests (such as getting around compliance checks) get a firm, brief refusal. Attempts to change Koya's instructions get the same treatment ("I can't change how I work or share how I'm set up…"). None of these calls a tool, and each is logged as a `declined_out_of_scope` event. Text the caller types or says that looks like a RelayPay system line is defused before it reaches the model, so only the server can tell Koya who is signed in.
4. **Koya replies out loud.** Replies stream back word by word, so Vapi starts speaking while the rest is still being generated. Before looking anything up, Koya says a short phrase such as "Let me check that for you" so the caller isn't left in silence.
5. **When the call ends,** Vapi sends an end-of-call report. The conversation record is closed with its end time, final status (completed, escalated, ticket created, abandoned or error) and a summary.

## The tools (MCP server)

| Tool | Purpose |
| --- | --- |
| `search_knowledge_base` | Finds approved RelayPay policy text (37 chunks of the knowledge base) |
| `lookup_customer` | Finds an account and verifies the caller |
| `lookup_transaction` / `lookup_payout` | Reports the real status and the customer-safe summary |
| `create_support_ticket` | Logs an issue for the support team |
| `create_escalation` | Hands the case to a specialist with the caller's name, email and callback time |
| `log_conversation_event` | Records notable decisions |

The MCP server runs on its own and can be deployed separately. It holds the data rules, so they're enforced in code, not only in the prompt:
- A caller counts as verified only when two identifiers match the same account (for example "Amara" plus "LagosLedger"), or when they are **signed in to the dashboard**: the web app passes a short-lived signed token with the call, and the agent server checks it before trusting it. Signed-in callers skip voice verification, Koya can see their recent payments, and escalations use the contact details on their account.
- Amounts and recipients are withheld from callers who aren't verified.
- Internal notes and compliance reasoning are never returned for Koya to read out.

## What gets recorded (Supabase)

| Table | What it holds |
| --- | --- |
| `conversations` | Channel, caller, start and end time, final status, summary |
| `conversation_turns` | What the caller said, what Koya said, the answer type, confidence note, tools used and latency |
| `retrieval_logs` | Every knowledge-base search, and which sections were used |
| `tool_call_logs` | Every tool call: purpose, inputs and results (sensitive values masked), status, errors, timing |
| `support_tickets` / `escalations` | Follow-ups created during calls |
| `evaluations` | Results of the automated test scenarios |

### Duplicates

The same request never creates two records:

- **Same call, or the callback form again within 10 minutes:** the existing ticket or escalation is returned, with no new record and no second email (logged as `duplicate_prevented`). Two identical tool calls arriving at once are queued, so they can't both slip through.
- **A later call within 72 hours about the same open issue:** the open case is reused. Koya tells the caller "you already have a case open", a new callback time replaces the old one, and the support team gets a **Repeat contact** email (logged as `repeat_contact`). Two requests are the same issue when they share a TXN/PAY/TKT/ESC reference. Otherwise the category decides, except "other", which needs a shared reference to match across calls. A different reference, or a closed case, means a new record. The rules live in `packages/shared/src/duplicates.ts`.
- **Vapi resending an identical turn:** the reply already given is sent again without re-running the agent (logged as `duplicate_request`).
- Eval runs only dedupe within their own call and close their test cases afterwards, so they never collide with real customers' cases.

The seed data (5 customers, 5 transactions, 3 payouts) lives in the same database. Row-level security blocks all public access, so only the servers can read or write.

## How to use it

- **Talk to Koya:** on the dashboard, click **Help & support** (or go straight to `/support`), click **Speak with Koya**, and ask about fees, payout timelines, a transaction such as "TXN-9001", or your account.
- **Ask for a callback instead:** the form at the bottom of the page creates an escalation for a specialist.
- **Try it without voice:** `pnpm chat` runs the same agent in the terminal.
- **Check behaviour:** `pnpm eval` runs the eight test scenarios and updates `docs/TESTING_EVIDENCE.md`.
- **Set it up:** follow the [README](../README.md): Supabase, then the MCP server, the agent server, ngrok, `pnpm vapi:sync`, and the web app.
