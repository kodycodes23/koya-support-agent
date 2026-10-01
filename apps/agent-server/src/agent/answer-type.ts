import type { AnswerType, Confidence } from "@koya/shared";

/** One MCP tool call made during a turn, with its parsed JSON result (when there was one). */
export interface ToolOutcome {
  name: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

export interface Classification {
  answerType: AnswerType;
  confidence: Confidence;
  note: string;
}

const DECLINE = /can(no|')t (confidently )?(answer|say|guarantee|confirm|promise)|not able to (answer|confirm|guarantee)|unable to (answer|guarantee)|don't have (that|approved) information|no approved/i;
const OUT_OF_SCOPE = /outside (of )?(what I can help with|my scope)|can(no|')t help (you )?with (that|this)|can only help with|can(no|')t change how I work/i;
/** Note on turns where Koya turned down an out-of-scope, harmful or instruction-changing request. */
export const OUT_OF_SCOPE_NOTE = "Out-of-scope or unsafe request declined";
const ESCALATION_TALK = /specialist|escalat|call(back| you back)|someone from (our|the) team/i;

/**
 * Classifies a turn from what actually happened — which tools ran and what they returned — rather
 * than from the model's self-report. Order matters: an escalation outranks a lookup in the same turn.
 */
export function classifyTurn(tools: ToolOutcome[], reply: string): Classification {
  const find = (name: string) => tools.filter((t) => t.name === name);
  const asks = reply.trim().endsWith("?");

  const escalation = find("create_escalation").find((t) => t.result?.escalation_id);
  if (escalation) {
    return { answerType: "escalated", confidence: "high", note: `Escalation ${escalation.result!.escalation_id} created (${escalation.input.category ?? "uncategorised"})` };
  }

  const ticket = find("create_support_ticket").find((t) => t.result?.ticket_id);
  if (ticket) {
    return { answerType: "answered", confidence: "high", note: `Support ticket ${ticket.result!.ticket_id} created` };
  }

  const lookups = tools.filter((t) => t.name.startsWith("lookup_"));
  if (lookups.length) {
    const parts = lookups.map((t) => {
      const r = t.result ?? {};
      const ref = r.transaction_id ?? r.payout_id ?? r.customer_id ?? Object.values(t.input)[0] ?? "record";
      if (r.found === false) return `${t.name}: no record for ${String(ref)}`;
      if (t.name === "lookup_customer") return `lookup_customer: ${r.verified ? `verified ${String(r.customer_id)}` : "not verified"}`;
      return `${t.name}: ${String(ref)} ${String(r.status ?? "")}${r.escalation_recommended ? " (escalation recommended)" : ""}`.trim();
    });
    const anyFound = lookups.some((t) => t.result?.found !== false);
    const needsHuman = lookups.some((t) => t.result?.escalation_recommended === true);
    if (needsHuman && ESCALATION_TALK.test(reply)) return { answerType: "escalated", confidence: "high", note: `${parts.join("; ")}; collecting callback details` };
    return { answerType: "lookup", confidence: anyFound ? "high" : "low", note: parts.join("; ") };
  }

  if (OUT_OF_SCOPE.test(reply)) return { answerType: "declined", confidence: "high", note: OUT_OF_SCOPE_NOTE };

  const searches = find("search_knowledge_base");
  if (searches.length) {
    const chunks = searches.flatMap((t) => (Array.isArray(t.result?.chunks) ? (t.result!.chunks as { section?: string; score?: number }[]) : []));
    if (!chunks.length || DECLINE.test(reply)) {
      return { answerType: "declined", confidence: "low", note: chunks.length ? "Knowledge base did not support a confident answer" : "No matching approved knowledge" };
    }
    const top = Math.max(...chunks.map((c) => c.score ?? 0));
    const sections = [...new Set(chunks.slice(0, 3).map((c) => c.section).filter(Boolean))].join("; ");
    return { answerType: "answered", confidence: top >= 0.5 ? "high" : "medium", note: `Grounded in: ${sections}` };
  }

  if (DECLINE.test(reply)) return { answerType: "declined", confidence: "medium", note: "Declined without approved knowledge" };
  if (asks && ESCALATION_TALK.test(reply)) return { answerType: "escalated", confidence: "medium", note: "Collecting details for a specialist callback" };
  if (asks) return { answerType: "clarifying", confidence: "high", note: "Asked for more detail before acting" };
  return { answerType: "answered", confidence: "medium", note: "Conversational reply; no tool needed" };
}
