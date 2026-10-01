/**
 * Evaluation runner: executes every scenario from assets/test-scenarios.md against the
 * agent in text mode, stores results in the `evaluations` table and regenerates
 * docs/TESTING_EVIDENCE.md.
 *
 *   pnpm eval                 all scenarios
 *   pnpm eval --only 1,4,7    a subset
 *
 * Requires the MCP server (pnpm mcp:dev). Each scenario gets its own `eval` conversation,
 * so its tool calls, retrievals, tickets and escalations are linked and reviewable.
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createLogger, createServiceClient } from "@koya/shared";
import type { TurnResult } from "../agent/run-turn.ts";
import { TurnService } from "../agent/turn-service.ts";
import { agentConfig } from "../config.ts";
import { ConversationStore } from "../db.ts";
import { env } from "../env.ts";
import { renderEvidence, type ScenarioOutcome } from "./evidence.ts";
import { SCENARIOS, VOICE_STYLE_CHECKS, type EvalContext, type Scenario } from "./scenarios.ts";

const log = createLogger("eval", process.env.LOG_LEVEL ?? "warn");
const db = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const store = new ConversationStore(db);
const turns = new TurnService(agentConfig(log), store, log);
const CONCURRENCY = 3;
const EVIDENCE_PATH = fileURLToPath(new URL("../../../../docs/TESTING_EVIDENCE.md", import.meta.url));

function selected(): Scenario[] {
  const i = process.argv.indexOf("--only");
  if (i === -1) return SCENARIOS;
  const ids = new Set((process.argv[i + 1] ?? "").split(",").map((s) => s.trim()));
  return SCENARIOS.filter((s) => ids.has(s.id));
}

async function rowsFor(table: string, conversationId: string) {
  const { data, error } = await db.from(table).select("*").eq("conversation_id", conversationId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

function describeActual(results: TurnResult[], tickets: Record<string, unknown>[], escalations: Record<string, unknown>[]): string {
  const parts = results.map(
    (t, i) => `Turn ${i + 1} [${t.answerType}; tools: ${t.toolsUsed.join(", ") || "none"}]: "${t.reply}"`,
  );
  if (tickets.length) parts.push(`Ticket(s): ${tickets.map((t) => `${t.ticket_ref} (${t.category}/${t.priority})`).join(", ")}`);
  if (escalations.length) {
    parts.push(`Escalation(s): ${escalations.map((e) => `${e.escalation_ref} (${e.category}${e.call_booked ? `, callback ${e.preferred_time}` : ""})`).join(", ")}`);
  }
  return parts.join(" | ");
}

async function runScenario(runId: string, scenario: Scenario): Promise<ScenarioOutcome> {
  const convo = await store.create({ channel: "eval", callerId: `eval:${scenario.id}`, metadata: { run_id: runId, scenario_id: scenario.id } });
  const results: TurnResult[] = [];
  let session: string | null = null;
  for (const text of scenario.turns) {
    const turn = await turns.handleTurn({ conversationId: convo.id, channel: "eval", userText: text, resumeSessionId: session });
    session = turn.sessionId ?? session;
    results.push(turn);
  }
  const [tickets, escalations] = await Promise.all([rowsFor("support_tickets", convo.id), rowsFor("escalations", convo.id)]);
  const ctx: EvalContext = {
    turns: results,
    tools: [...new Set(results.flatMap((t) => t.toolsUsed))],
    replies: results.map((t) => t.reply).join("\n"),
    tickets,
    escalations,
  };
  const checks = [...scenario.checks, ...VOICE_STYLE_CHECKS].map((c) => {
    const r = c.run(ctx);
    return { name: c.name, passed: r === true, detail: r === true ? null : r };
  });
  const failed = checks.filter((c) => !c.passed);
  const passed = failed.length === 0;
  const latency = results.map((t) => t.firstTextMs).filter((n): n is number => n !== null);
  const notes = [
    passed ? `All ${checks.length} checks passed.` : `Failed: ${failed.map((c) => `${c.name} (${c.detail})`).join("; ")}.`,
    `First spoken text: ${latency.length ? `${Math.max(...latency)}ms worst turn` : "n/a"}.`,
    `Model ${env.KOYA_MODEL}. Conversation ${convo.id}.`,
  ].join(" ");
  const actual = describeActual(results, tickets, escalations);

  const { error } = await db.from("evaluations").insert({
    run_id: runId,
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    input: scenario.turns.join(" → "),
    expected_behavior: scenario.expected.join(" "),
    actual_behavior: actual,
    tools_called: ctx.tools,
    answer_type: results.at(-1)?.answerType ?? null,
    passed,
    notes,
    conversation_id: convo.id,
  });
  if (error) throw new Error(`insert evaluation: ${error.message}`);
  turns.release(convo.id);
  await store.close(convo.id, { fallbackStatus: "completed", endedReason: "eval-complete", summary: `Eval scenario ${scenario.id}: ${scenario.name}` });

  const mark = passed ? "PASS" : "FAIL";
  console.log(`${mark}  ${scenario.id}. ${scenario.name}${passed ? "" : `\n      ${failed.map((c) => `✗ ${c.name}: ${c.detail}`).join("\n      ")}`}`);
  return { scenario, results, tickets, escalations, checks, passed, notes, conversationId: convo.id, actual };
}

async function logCounts(conversationIds: string[]) {
  const count = async (table: string, column = "conversation_id") => {
    const { count: n, error } = await db.from(table).select("*", { count: "exact", head: true }).in(column, conversationIds);
    if (error) throw new Error(`${table}: ${error.message}`);
    return n ?? 0;
  };
  // Tool-call audit rows are written in the background by the MCP server; give them a moment.
  await new Promise((r) => setTimeout(r, 1500));
  return {
    conversations: await count("conversations", "id"),
    conversation_turns: await count("conversation_turns"),
    retrieval_logs: await count("retrieval_logs"),
    tool_call_logs: await count("tool_call_logs"),
    support_tickets: await count("support_tickets"),
    escalations: await count("escalations"),
    evaluations: await count("evaluations"),
  };
}

async function main() {
  const runId = randomUUID();
  const scenarios = selected();
  console.log(`Eval run ${runId}: ${scenarios.length} scenario(s), model ${env.KOYA_MODEL}\n`);

  const outcomes: ScenarioOutcome[] = new Array(scenarios.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, scenarios.length) }, async () => {
      while (next < scenarios.length) {
        const i = next++;
        outcomes[i] = await runScenario(runId, scenarios[i]!);
      }
    }),
  );

  const counts = await logCounts(outcomes.map((o) => o.conversationId));
  const passedCount = outcomes.filter((o) => o.passed).length;
  console.log(`\n${passedCount}/${outcomes.length} passed. Records: ${JSON.stringify(counts)}`);

  if (scenarios.length === SCENARIOS.length) {
    await writeFile(EVIDENCE_PATH, renderEvidence({ runId, model: env.KOYA_MODEL, date: new Date(), outcomes, counts }));
    console.log(`Wrote ${EVIDENCE_PATH}`);
  } else {
    console.log("Partial run: docs/TESTING_EVIDENCE.md not rewritten (run without --only to regenerate).");
  }
  process.exit(passedCount === outcomes.length ? 0 : 1);
}

main().catch((err: unknown) => {
  log.error({ err }, "eval run failed");
  console.error(err);
  process.exit(1);
});
