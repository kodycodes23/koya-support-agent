import type { ToolContext } from "../context.ts";

/**
 * What a specialist needs to pick the case up: the account snapshot, what Koya looked up on this
 * call (with results), and the conversation so far. Internal support notes are not included.
 */
export async function gatherContext(ctx: ToolContext, customerId: string | null) {
  // The turn that triggered this escalation is saved only after Koya finishes replying. Wait
  // briefly for it, so the transcript includes what the caller just said.
  if (ctx.conversationId) {
    const countTurns = async () =>
      (await ctx.db.from("conversation_turns").select("id", { count: "exact", head: true }).eq("conversation_id", ctx.conversationId!)).count ?? 0;
    const before = await countTurns();
    for (let waited = 0; waited < 20_000 && (await countTurns()) <= before; waited += 1000) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const [customerRes, toolsRes, turnsRes] = await Promise.all([
    customerId
      ? ctx.db.from("customers").select("company_name, plan, account_status, kyc_status").eq("customer_id", customerId).maybeSingle()
      : Promise.resolve({ data: null }),
    ctx.conversationId
      ? ctx.db.from("tool_call_logs").select("tool_name, result_summary").eq("conversation_id", ctx.conversationId).like("tool_name", "lookup_%").order("created_at")
      : Promise.resolve({ data: [] }),
    ctx.conversationId
      ? ctx.db.from("conversation_turns").select("user_transcript, assistant_response").eq("conversation_id", ctx.conversationId).order("turn_index", { ascending: false }).limit(8)
      : Promise.resolve({ data: [] }),
  ]);
  const customer = (customerRes.data ?? null) as { company_name: string; plan: string; account_status: string; kyc_status: string } | null;
  const checks = ((toolsRes.data ?? []) as { tool_name: string; result_summary: string | null }[]).map(
    (t) => `${t.tool_name.replace("lookup_", "")}: ${String(t.result_summary ?? "").slice(0, 160)}`,
  );
  const clip = (s: string) => (s.length > 400 ? `${s.slice(0, 399)}…` : s);
  const transcript = ((turnsRes.data ?? []) as { user_transcript: string; assistant_response: string }[])
    .reverse()
    .flatMap((t) => [
      { speaker: "Caller" as const, text: clip(t.user_transcript) },
      { speaker: "Koya" as const, text: clip(t.assistant_response) },
    ]);
  return {
    customer,
    account: customer ? { plan: customer.plan, status: customer.account_status, kyc: customer.kyc_status } : null,
    checks,
    transcript,
  };
}
