/** Dev tool: prints a timeline of one agent turn to find where latency goes. */
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createLogger, createServiceClient } from "@koya/shared";
import { buildOptions } from "../src/agent/run-turn.ts";
import { agentConfig } from "../src/config.ts";
import { ConversationStore } from "../src/db.ts";
import { env } from "../src/env.ts";

const prompt = process.argv[2] ?? "What fees does RelayPay charge for international payments?";
const store = new ConversationStore(createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));
const convo = await store.create({ channel: "text", callerId: "latency-probe" });
const cfg = agentConfig(createLogger("probe", "warn"));
const t0 = performance.now();
const at = (label: string) => console.log(`${String(Math.round(performance.now() - t0)).padStart(6)}ms  ${label}`);
at("query() called");
const q = query({ prompt, options: buildOptions(cfg, { conversationId: convo.id, channel: "text" }, new AbortController(), false) });
let firstDelta = true;
for await (const m of q as AsyncIterable<SDKMessage>) {
  if (m.type === "system" && m.subtype === "init") at(`init (mcp: ${m.mcp_servers.map((s) => `${s.name}=${s.status}`).join(",")}; tools: ${m.tools.length})`);
  else if (m.type === "stream_event") {
    if (m.event.type === "message_start") { at("model message_start"); firstDelta = true; }
    if (m.event.type === "content_block_delta" && firstDelta) { at("first delta"); firstDelta = false; }
  } else if (m.type === "assistant") {
    for (const b of m.message.content) if (b.type === "tool_use") at(`tool_use ${b.name}`);
  } else if (m.type === "user") at("tool_result returned");
  else if (m.type === "result") at(`result (${m.subtype}, api ${m.duration_api_ms}ms, turns ${m.num_turns})`);
}
