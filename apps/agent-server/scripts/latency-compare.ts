/** Dev tool: compares time-to-first-text for the Agent SDK path vs a direct Messages API call. */
import Anthropic from "@anthropic-ai/sdk";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createLogger, createServiceClient } from "@koya/shared";
import { buildOptions } from "../src/agent/run-turn.ts";
import { buildSystemPrompt } from "../src/agent/prompt.ts";
import { agentConfig } from "../src/config.ts";
import { ConversationStore } from "../src/db.ts";
import { env } from "../src/env.ts";

const PROMPT = "Hello. Can you hear me?";
const cfg = agentConfig(createLogger("cmp", "warn"));
const store = new ConversationStore(createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));

async function sdkTurn(conversationId: string, resume: string | null) {
  const t0 = performance.now();
  const marks: Record<string, number> = {};
  let session: string | null = null;
  const q = query({ prompt: PROMPT, options: buildOptions(cfg, { conversationId, channel: "voice", resumeSessionId: resume }, new AbortController(), Boolean(resume)) });
  for await (const m of q as AsyncIterable<SDKMessage>) {
    const t = Math.round(performance.now() - t0);
    session ??= (m as { session_id?: string }).session_id ?? null;
    if (m.type === "system" && m.subtype === "init") marks.init ??= t;
    if (m.type === "stream_event" && m.event.type === "message_start") marks.message_start ??= t;
    if (m.type === "stream_event" && m.event.type === "content_block_delta") marks.first_delta ??= t;
    if (m.type === "result") { marks.done = t; marks.api_ms = m.duration_api_ms; }
  }
  return { marks, session };
}

async function directTurn() {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = performance.now();
  let first = 0;
  const stream = client.messages.stream({
    model: env.KOYA_MODEL,
    max_tokens: 300,
    system: buildSystemPrompt({ today: new Date().toISOString().slice(0, 10), channel: "voice" }),
    messages: [{ role: "user", content: PROMPT }],
  });
  stream.on("text", () => { first ||= Math.round(performance.now() - t0); });
  await stream.finalMessage();
  return { first_delta: first, done: Math.round(performance.now() - t0) };
}

const convo = await store.create({ channel: "text", callerId: "latency-compare" });
for (let i = 1; i <= 2; i++) console.log(`direct API #${i}:`, await directTurn());
const a = await sdkTurn(convo.id, null);
console.log("agent SDK fresh:  ", a.marks);
const b = await sdkTurn(convo.id, a.session);
console.log("agent SDK resume: ", b.marks);
const c = await sdkTurn(convo.id, b.session);
console.log("agent SDK resume2:", c.marks);
