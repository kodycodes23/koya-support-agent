import { ESCALATION_CATEGORIES, emailConfigFromEnv, notifySupportTeam } from "@koya/shared";
import { z } from "zod";
import { inBackground } from "../background.ts";
import { defineTool } from "../define-tool.ts";
import type { ToolContext } from "../context.ts";
import { normalizeRef, verifiedCustomerFor } from "./shared.ts";

/**
 * What a specialist needs to pick the case up: the account snapshot, what Koya looked up on this
 * call (with results), and the conversation so far. Internal support notes are not included.
 */
async function gatherContext(ctx: ToolContext, customerId: string | null) {
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

export const createEscalation = defineTool({
  name: "create_escalation",
  title: "Escalate to a human specialist",
  description:
    "Hand the case to a human specialist. Use for compliance or KYC issues, disputes, refunds, cancellations, account " +
    "restrictions or suspensions, frustrated customers, and anything needing human judgment. " +
    "Collect the caller's name, email and preferred callback time first. If the conversation is already verified (e.g. a signed-in " +
    "caller), leave out user_name and user_email: the account's contact details are filled in by the server; never guess an email. " +
    "After escalating, confirm the follow-up and stop troubleshooting.",
  purpose: "Escalate a case to human support with callback details",
  inputSchema: {
    user_name: z.string().min(1).max(200).optional().describe("Required unless the caller is already verified"),
    user_email: z.email().max(200).optional().describe("As the caller gave it, normalized from speech. Omit for verified callers; never guess"),
    category: z.enum(ESCALATION_CATEGORIES).describe("Refunds and cancellations: dispute or payment"),
    reason: z
      .string()
      .min(5)
      .max(1000)
      .describe(
        "Case summary for the specialist, 2 to 4 sentences: what the caller reported in their own words, what you checked and found " +
          "(references and statuses), what they need from the specialist, and how they are feeling if it matters (e.g. frustrated, urgent).",
      ),
    preferred_time: z.string().max(200).optional().describe("Preferred callback time as the caller said it"),
    ticket_id: z.string().max(40).optional().describe("Related ticket number such as TKT-1001"),
    customer_id: z.string().max(40).optional(),
  },
  handler: async (input, ctx) => {
    // Signed-in / verified callers: take contact details from their account, never from a guess.
    const verifiedId = await verifiedCustomerFor(ctx);
    let userName = input.user_name;
    let userEmail = input.user_email;
    if (verifiedId && (!userName || !userEmail)) {
      const { data, error } = await ctx.db.from("customers").select("contact_name, contact_email").eq("customer_id", verifiedId).maybeSingle();
      if (error) throw new Error(error.message);
      userName ??= (data?.contact_name as string | undefined) ?? undefined;
      userEmail ??= (data?.contact_email as string | undefined) ?? undefined;
    }
    if (!userName || !userEmail) {
      return {
        status: "denied",
        result: { escalation_id: null, next_step: "Ask the caller for their name and email address before escalating." },
      };
    }
    const [ticketUuid, customerId] = await Promise.all([
      input.ticket_id
        ? ctx.db.from("support_tickets").select("id").eq("ticket_ref", normalizeRef("TKT", input.ticket_id)).maybeSingle()
            .then(({ data }) => (data?.id as string | undefined) ?? null)
        : null,
      input.customer_id
        ? ctx.db.from("customers").select("customer_id").eq("customer_id", input.customer_id.toUpperCase()).maybeSingle()
            .then(({ data }) => (data?.customer_id as string | undefined) ?? null)
        : verifiedId,
    ]);

    const firstName = userName.trim().split(/\s+/)[0];
    const followUp = input.preferred_time
      ? `A RelayPay specialist will call ${firstName} back around ${input.preferred_time} and follow up by email.`
      : `A RelayPay specialist will follow up with ${firstName} by email.`;

    const { data, error } = await ctx.db
      .from("escalations")
      .insert({
        conversation_id: ctx.conversationId,
        ticket_id: ticketUuid,
        customer_id: customerId,
        user_name: userName,
        user_email: userEmail.toLowerCase(),
        category: input.category,
        reason: input.reason,
        call_booked: Boolean(input.preferred_time),
        preferred_time: input.preferred_time ?? null,
        follow_up_summary: followUp,
      })
      .select("escalation_ref, status")
      .single();
    if (error) throw new Error(error.message);

    // Tell the support team by email (after the record exists, without delaying Koya's reply),
    // with context gathered by the server so it doesn't depend on what the model wrote.
    void (async () => {
      try {
        const context = await gatherContext(ctx, customerId);
        const customer = context.customer;
        inBackground(ctx.log, "escalation context", ctx.db.from("conversation_events").insert({
          conversation_id: ctx.conversationId,
          event_type: "escalation_context",
          summary: `Context captured for ${data.escalation_ref}`,
          metadata: { escalation_ref: data.escalation_ref, account: context.account, checks: context.checks, transcript: context.transcript },
        }));
        const id = await notifySupportTeam(emailConfigFromEnv(), {
          reference: data.escalation_ref as string,
          source: "voice",
          category: input.category,
          reason: input.reason,
          userName,
          userEmail: userEmail.toLowerCase(),
          customerId,
          company: (customer?.company_name as string | undefined) ?? null,
          preferredTime: input.preferred_time ?? null,
          followUp,
          conversationId: ctx.conversationId,
          account: context.account,
          checks: context.checks,
          transcript: context.transcript,
        });
        if (id === null) ctx.log.warn("RESEND_API_KEY not set: support-team email skipped");
        else ctx.log.info({ escalation: data.escalation_ref, emailId: id }, "support team emailed");
      } catch (err) {
        ctx.log.warn({ err, escalation: data.escalation_ref }, "support-team email failed (escalation is still recorded)");
      }
    })();

    inBackground(ctx.log, "conversation_events", ctx.db.from("conversation_events").insert({
      conversation_id: ctx.conversationId,
      event_type: "escalation_created",
      summary: `${data.escalation_ref} (${input.category}): ${input.reason}`.slice(0, 500),
      metadata: { escalation_ref: data.escalation_ref, category: input.category, call_booked: Boolean(input.preferred_time) },
    }));

    return {
      status: "success",
      result: {
        escalation_id: data.escalation_ref as string,
        status: data.status as string,
        follow_up_summary: followUp,
        next_step: "Confirm the follow-up to the caller in one or two sentences. Do not promise outcomes or timelines, and stop troubleshooting.",
      },
    };
  },
});
