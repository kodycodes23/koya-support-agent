/**
 * Text-mode REPL against the same agent core Vapi uses.
 *   pnpm chat                      interactive
 *   pnpm chat "question" "follow"  scripted: runs each argument as a turn, then exits
 * Requires the MCP server to be running (pnpm mcp:dev).
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createLogger, createServiceClient } from "@koya/shared";
import { TurnService } from "../agent/turn-service.ts";
import { agentConfig } from "../config.ts";
import { ConversationStore } from "../db.ts";
import { env } from "../env.ts";

const log = createLogger("chat", process.env.LOG_LEVEL ?? "warn");
const store = new ConversationStore(createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));
const turns = new TurnService(agentConfig(log), store, log);
const convo = await store.create({ channel: "text", callerId: "cli", metadata: { source: "pnpm chat" } });
let session: string | null = null;

async function say(text: string) {
  stdout.write("Koya: ");
  const turn = await turns.handleTurn({
    conversationId: convo.id,
    channel: "text",
    userText: text,
    resumeSessionId: session,
    onText: (t) => stdout.write(t),
  });
  session = turn.sessionId ?? session;
  stdout.write(
    `\n  [${turn.answerType}${turn.confidence ? `/${turn.confidence}` : ""} · tools: ${turn.toolsUsed.join(", ") || "none"} · first text ${turn.firstTextMs ?? "-"}ms · total ${turn.latencyMs}ms${turn.costUsd != null ? ` · $${turn.costUsd.toFixed(4)}` : ""}${turn.status !== "ok" ? ` · ${turn.status}` : ""}]\n`,
  );
}

console.log(`Conversation ${convo.id} (model ${env.KOYA_MODEL}). Ctrl+C or "exit" to quit.\n`);
const scripted = process.argv.slice(2);
if (scripted.length) {
  for (const line of scripted) {
    console.log(`You: ${line}`);
    await say(line);
  }
} else {
  const rl = createInterface({ input: stdin, output: stdout });
  while (true) {
    const line = (await rl.question("You: ")).trim();
    if (!line) continue;
    if (line === "exit") break;
    await say(line);
  }
  rl.close();
}
await store.close(convo.id, { fallbackStatus: "completed", endedReason: "cli-exit" });
process.exit(0);
