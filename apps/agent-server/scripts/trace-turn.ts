/** Dev tool: prints every SDK message of one turn (types, blocks, tool calls, stop reasons). */
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createLogger, createServiceClient } from "@koya/shared";
import { buildOptions } from "../src/agent/run-turn.ts";
import { agentConfig } from "../src/config.ts";
import { ConversationStore } from "../src/db.ts";
import { env } from "../src/env.ts";

const prompt = process.argv[2] ?? "My invoice payment failed and I need someone to look at it.";
const store = new ConversationStore(createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));
const convo = await store.create({ channel: "text", callerId: "trace" });
const q = query({ prompt, options: buildOptions(agentConfig(createLogger("trace", "warn")), { conversationId: convo.id, channel: "text" }, new AbortController(), false) });
const partial = new Map<number, { name: string; json: string }>();
for await (const m of q as AsyncIterable<SDKMessage>) {
  if (m.type === "stream_event") {
    const ev = m.event;
    if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") partial.set(ev.index, { name: ev.content_block.name, json: "" });
    if (ev.type === "content_block_delta" && ev.delta.type === "input_json_delta") {
      const p = partial.get(ev.index);
      if (p) p.json += ev.delta.partial_json;
    }
    if (ev.type === "content_block_stop" && partial.has(ev.index)) {
      const p = partial.get(ev.index)!;
      let ok = true;
      try { JSON.parse(p.json || "{}"); } catch { ok = false; }
      console.log(`  raw tool_use ${p.name} ${ok ? "valid" : "INVALID"} json=${JSON.stringify(p.json).slice(0, 400)}`);
      partial.delete(ev.index);
    }
    if (ev.type === "message_delta") console.log(`  message_delta stop_reason=${ev.delta.stop_reason}`);
    continue;
  }
  if (m.type === "assistant") {
    for (const b of m.message.content) {
      if (b.type === "text") console.log(`assistant.text (stop=${m.message.stop_reason}): ${JSON.stringify(b.text)}`);
      else if (b.type === "tool_use") console.log(`assistant.tool_use: ${b.name} ${JSON.stringify(b.input).slice(0, 200)}`);
      else console.log(`assistant.${b.type}`);
    }
  } else if (m.type === "user") {
    const c = (m.message as { content: unknown }).content;
    console.log(`user: ${JSON.stringify(c).slice(0, 300)}`);
  } else if (m.type === "result") {
    console.log(`result: ${m.subtype} turns=${m.num_turns} stop=${m.stop_reason} denials=${JSON.stringify(m.permission_denials)}`);
  } else console.log(`${m.type}${"subtype" in m ? `.${m.subtype}` : ""}`);
}
