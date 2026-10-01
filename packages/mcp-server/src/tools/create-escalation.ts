import { ESCALATION_CATEGORIES, emailConfigFromEnv, notifySupportTeam, referencesIn } from "@koya/shared";
import { z } from "zod";
import { inBackground } from "../background.ts";
import { defineTool } from "../define-tool.ts";
import type { ToolContext } from "../context.ts";
import { findOpenCase, serialized, spokenDate } from "../duplicates.ts";
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

function logEvent(ctx: ToolContext, type: string, summary: string, metadata: Record<string, unknown>) {
  inBackground(ctx.log, "conversation_events", ctx.db.from("conversation_events").insert({ conversation_id: ctx.conversationId, event_type: type, summary, metadata }));
}

/**
 * Tells the support team by email after the record exists, without delaying Koya's reply, with
 * context gathered by the server so it doesn't depend on what the model wrote.
 */
function emailTeam(
  ctx: ToolContext,
  e: {
    ref: string;
    input: { category: string; reason: string };
    userName: string;
    userEmail: string;
    customerId: string | null;
    preferredTime: string | null;
    followUp: string;
    repeatOf: Record<string, unknown> | null;
  },
) {
  void (async () => {
    try {
      const context = await gatherContext(ctx, e.customerId);
      inBackground(ctx.log, "escalation context", ctx.db.from("conversation_events").insert({
        conversation_id: ctx.conversationId,
        event_type: "escalation_context",
        summary: `Context captured for ${e.ref}${e.repeatOf ? " (repeat contact)" : ""}`,
        metadata: { escalation_ref: e.ref, account: context.account, checks: context.checks, transcript: context.transcript },
      }));
      const id = await notifySupportTeam(emailConfigFromEnv(), {
        reference: e.ref,
        source: "voice",
        category: e.input.category,
        reason: e.input.reason,
        userName: e.userName,
        userEmail: e.userEmail,
        customerId: e.customerId,
        company: (context.customer?.company_name as string | undefined) ?? null,
        preferredTime: e.preferredTime,
        followUp: e.followUp,
        conversationId: ctx.conversationId,
        account: context.account,
        checks: context.checks,
        transcript: context.transcript,
        repeatContact: e.repeatOf ? { openedAt: new Date(String(e.repeatOf.created_at)) } : null,
      });
      if (id === null) ctx.log.warn("RESEND_API_KEY not set: support-team email skipped");
      else ctx.log.info({ escalation: e.ref, emailId: id, repeat: Boolean(e.repeatOf) }, "support team emailed");
    } catch (err) {
      ctx.log.warn({ err, escalation: e.ref }, "support-team email failed (escalation is still recorded)");
    }
  })();
}

export const createEscalation = defineTool({
  name: "create_escalation",
  title: "Escalate to a human specialist",
  description:
    "Hand the case to a human specialist. Use for compliance or KYC issues, disputes, refunds, cancellations, account " +
    "restrictions or suspensions, frustrated customers, and anything needing human judgment. " +
    "Collect the caller's name, email and preferred callback time first. If the conversation is already verified (e.g. a signed-in " +
    "caller), leave out user_name and user_email: the account's contact details are filled in by the server; never guess an email. " +
    "After escalating, confirm the follow-up and stop troubleshooting. If the caller already has an open case for the same issue, " +
    "it is reused (already_open true) instead of creating another; tell them its number.",
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
    const followUpFor = (time: string | null | undefined) =>
      time
        ? `A RelayPay specialist will call ${firstName} back around ${time} and follow up by email.`
        : `A RelayPay specialist will follow up with ${firstName} by email.`;
    const email = userEmail.toLowerCase();
    const issue = { category: input.category, refs: referencesIn(input.reason, input.ticket_id) };

    return serialized(`case:${customerId ?? email}`, async () => {
      const open = await findOpenCase(ctx, {
        table: "escalations",
        issue,
        issueOf: (r) => ({ category: String(r.category), refs: referencesIn(String(r.reason ?? "")) }),
        owner: customerId ? { column: "customer_id", value: customerId } : { column: "user_email", value: email },
      });

      if (open?.kind === "duplicate") {
        const ref = open.row.escalation_ref as string;
        logEvent(ctx, "duplicate_prevented", `create_escalation repeated on the same call; reused ${ref}`, { escalation_ref: ref });
        return {
          status: "success",
          result: {
            escalation_id: ref,
            status: open.row.status as string,
            already_open: true,
            follow_up_summary: open.row.follow_up_summary as string | null,
            next_step: "This was already escalated on this call. Do not call create_escalation again. Confirm the existing case number and the follow-up in one sentence.",
          },
        };
      }

      if (open?.kind === "repeat") {
        const ref = open.row.escalation_ref as string;
        // A new callback time from the caller replaces the old one; otherwise the case is unchanged.
        const newTime = input.preferred_time && input.preferred_time !== open.row.preferred_time ? input.preferred_time : null;
        const followUp = newTime ? followUpFor(newTime) : ((open.row.follow_up_summary as string | null) ?? followUpFor(open.row.preferred_time as string | null));
        if (newTime) {
          const { error } = await ctx.db.from("escalations").update({ preferred_time: newTime, call_booked: true, follow_up_summary: followUp }).eq("id", open.row.id);
          if (error) throw new Error(error.message);
        }
        logEvent(ctx, "repeat_contact", `Caller got in touch again about ${ref}: ${input.reason}`.slice(0, 500), {
          escalation_ref: ref,
          opened_at: open.row.created_at,
          callback_time_updated: Boolean(newTime),
        });
        emailTeam(ctx, { ref, input, userName, userEmail: email, customerId, preferredTime: newTime ?? (open.row.preferred_time as string | null), followUp, repeatOf: open.row });
        return {
          status: "success",
          result: {
            escalation_id: ref,
            status: open.row.status as string,
            already_open: true,
            opened: spokenDate(open.row.created_at),
            callback_time_updated: Boolean(newTime),
            follow_up_summary: followUp,
            next_step:
              `The caller already has an open case for this, ${ref}, opened ${spokenDate(open.row.created_at)}. No new case was created. ` +
              "Tell them the case number, that it is still open and that you have let the specialist team know they called again" +
              `${newTime ? ", with their new callback time" : ""}. Do not promise outcomes or timelines, and stop troubleshooting.`,
          },
        };
      }

      const followUp = followUpFor(input.preferred_time);
      const { data, error } = await ctx.db
        .from("escalations")
        .insert({
          conversation_id: ctx.conversationId,
          ticket_id: ticketUuid,
          customer_id: customerId,
          user_name: userName,
          user_email: email,
          category: input.category,
          reason: input.reason,
          call_booked: Boolean(input.preferred_time),
          preferred_time: input.preferred_time ?? null,
          follow_up_summary: followUp,
        })
        .select("escalation_ref, status")
        .single();
      if (error) throw new Error(error.message);
      const ref = data.escalation_ref as string;

      emailTeam(ctx, { ref, input, userName, userEmail: email, customerId, preferredTime: input.preferred_time ?? null, followUp, repeatOf: null });
      logEvent(ctx, "escalation_created", `${ref} (${input.category}): ${input.reason}`.slice(0, 500), {
        escalation_ref: ref,
        category: input.category,
        call_booked: Boolean(input.preferred_time),
      });

      return {
        status: "success",
        result: {
          escalation_id: ref,
          status: data.status as string,
          follow_up_summary: followUp,
          next_step: "Confirm the follow-up to the caller in one or two sentences. Do not promise outcomes or timelines, and stop troubleshooting.",
        },
      };
    });
  },
});
