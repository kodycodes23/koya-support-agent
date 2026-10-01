/** Dev experiment: does the in-band <koya/> tag cause malformed tool calls with thinking off? */
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createLogger, createServiceClient } from "@koya/shared";
import { buildOptions } from "../src/agent/run-turn.ts";
import { agentConfig } from "../src/config.ts";
import { ConversationStore } from "../src/db.ts";
import { env } from "../src/env.ts";

const variant = process.argv[2] ?? "no-tag";
const prompt = "My invoice payment failed and I need someone to look at it.";
const store = new ConversationStore(createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));
const cfg = agentConfig(createLogger("x", "error"));
let retries = 0, errors = 0;
const runs = 12;
await Promise.all(Array.from({ length: runs }, async () => {
  const convo = await store.create({ channel: "text", callerId: `tag-exp:${variant}` });
  const opts = buildOptions(cfg, { conversationId: convo.id, channel: "text" }, new AbortController(), false);
  if (variant === "no-tag" && typeof opts.systemPrompt === "string") {
    opts.systemPrompt = opts.systemPrompt.replace(/METADATA TAG[\s\S]*?\n\nCHOOSE ONE PATH/, "CHOOSE ONE PATH");
  }
  try {
  for await (const m of query({ prompt, options: opts }) as AsyncIterable<SDKMessage>) {
    if (m.type === "user") {
      const c = (m.message as { content?: unknown }).content;
      if (Array.isArray(c) && c.some((b: { type?: string; text?: string }) => b.type === "text" && /valid tool call/i.test(b.text ?? ""))) retries++;
    }
    if (m.type === "result" && (m.subtype !== "success" || m.is_error)) errors++;
  }
  } catch {
    errors++; // the SDK throws when Claude Code ends with an error result
  }
}));
console.log(`${variant}: ${runs} runs, harness retries=${retries}, errors=${errors}`);
