import { ESCALATION_CATEGORIES, callbackTimeProblem, emailConfigFromEnv, notifySupportTeam, referencesIn } from "@koya/shared";
import { z } from "zod";
import { inBackground } from "../background.ts";
import { defineTool } from "../define-tool.ts";
import type { ToolContext } from "../context.ts";
import { findOpenCase, serialized, spokenDate } from "../duplicates.ts";
import { gatherContext } from "./case-context.ts";
import { normalizeRef, verifiedCustomerFor } from "./shared.ts";

/** The newest name and email the caller typed during this conversation (typed_input events). */
async function latestTyped(ctx: ToolContext): Promise<{ name?: string; email?: string }> {
  if (!ctx.conversationId) return {};
  const { data } = await ctx.db.from("conversation_events").select("metadata, created_at").eq("conversation_id", ctx.conversationId).eq("event_type", "typed_input");
  const out: { name?: string; email?: string } = {};
  for (const e of ((data ?? []) as { metadata: { field?: string; value?: string }; created_at: string }[]).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const v = e.metadata?.value?.trim();
    if (!v) continue;
    if (e.metadata.field === "name") out.name = v.slice(0, 200);
    if (e.metadata.field === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) out.email = v.toLowerCase();
  }
  return out;
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
    category: z.enum(ESCALATION_CATEGORIES).describe("Refunds and cancellations: dispute or payment. A prospective customer who wants to open an account: onboarding"),
    reason: z
      .string()
      .min(5)
      .max(1000)
      .describe(
        "Case summary for the specialist, 2 to 4 sentences: what the caller reported in their own words, what you checked and found " +
          "(references and statuses), what they need from the specialist, and how they are feeling if it matters (e.g. frustrated, urgent).",
      ),
    preferred_time: z.string().max(200).optional().describe("Preferred callback time as the caller said it. Must be between 9:30am and 4:30pm (working hours 9am to 5pm)"),
    ticket_id: z.string().max(40).optional().describe("Related ticket number such as TKT-1001"),
    customer_id: z.string().max(40).optional(),
  },
  handler: async (input, ctx) => {
    // Callbacks only inside working hours (9:30am to 4:30pm); nothing is saved for another time.
    const hoursProblem = callbackTimeProblem(input.preferred_time);
    if (hoursProblem) {
      return {
        status: "denied",
        result: {
          escalation_id: null,
          outside_callback_hours: true,
          next_step:
            `Nothing was booked. ${hoursProblem} Tell the caller clearly that we can't call them at that time and why ` +
            "(our team works from 9am to 5pm, and callbacks can't start in the first or last 30 minutes), then ask which time between 9:30am and 4:30pm suits them. " +
            "Don't say anyone will call until create_escalation returns an escalation_id.",
        },
      };
    }
    // Signed-in / verified callers: take contact details from their account, never from a guess.
    const verifiedId = await verifiedCustomerFor(ctx);
    // What the caller typed on screen beats what speech-to-text heard (names, emails).
    const typed = await latestTyped(ctx);
    let userName = typed.name ?? input.user_name;
    let userEmail = typed.email ?? input.user_email;
    if (verifiedId && (!userName || !userEmail)) {
      const { data, error } = await ctx.db.from("customers").select("contact_name, contact_email").eq("customer_id", verifiedId).maybeSingle();
      if (error) throw new Error(error.message);
      userName ??= (data?.contact_name as string | undefined) ?? undefined;
      userEmail ??= (data?.contact_email as string | undefined) ?? undefined;
    }
    if (!userName || !userEmail) {
      return {
        status: "denied",
        result: {
          escalation_id: null,
          next_step:
            "Nothing was created yet, so don't tell the caller anyone will call. Ask for their full name and email address (they can type them), then call create_escalation again with them.",
        },
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
            next_step: `This was already escalated on this call as ${open.row.escalation_ref as string}. Don't call create_escalation again; remind the caller of the case number and what happens next: ${String(open.row.follow_up_summary ?? "a specialist will follow up")}.`,
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
              "Tell them the case number, that it is still open, and that you've let the specialist team know they got in touch again" +
              `${newTime ? `, with their new callback time (${newTime})` : ""}. Then say what happens next: ${followUp} Do not promise outcomes or timelines, and stop troubleshooting.`,
          },
        };
      }

      const followUp = followUpFor(input.preferred_time);
      const row = {
        conversation_id: ctx.conversationId,
        ticket_id: ticketUuid,
        customer_id: customerId,
        user_name: userName,
        user_email: email,
        category: input.category as string,
        reason: input.reason,
        call_booked: Boolean(input.preferred_time),
        preferred_time: input.preferred_time ?? null,
        follow_up_summary: followUp,
      };
      let { data, error } = await ctx.db.from("escalations").insert(row).select("escalation_ref, status").single();
      // Before migration 20261002000006 the database doesn't know "onboarding": keep the case as "other".
      if (error?.code === "23514" && input.category === "onboarding") {
        ctx.log.warn("escalations.category has no 'onboarding' yet (run migration 20261002000006); saving as 'other'");
        ({ data, error } = await ctx.db
          .from("escalations")
          .insert({ ...row, category: "other", reason: `[Onboarding] ${input.reason}` })
          .select("escalation_ref, status")
          .single());
      }
      if (error || !data) throw new Error(error?.message ?? "escalation insert returned no row");
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
          next_step:
            `The case is created. In two or three short sentences, tell the caller what happens next: their case number is ${ref}; ` +
            `${input.category === "onboarding" ? "RelayPay's onboarding team" : "a RelayPay specialist"} now has the details from this conversation, so they won't need to explain it again; ` +
            `${input.preferred_time ? `they'll be called around ${input.preferred_time} and followed up by email` : "they'll be contacted by email"}; ` +
            "and there's nothing else they need to do for now. Don't promise outcomes or timelines, and stop troubleshooting.",
        },
      };
    });
  },
});
