import type { CustomerRow } from "@koya/shared";
import { z } from "zod";
import { defineTool } from "../define-tool.ts";
import type { ToolContext } from "../context.ts";
import { nextFactorHint, normalizeCustomerId, normalizeEmail, normalizeName, verifyIdentity } from "../verification.ts";
import { verifiedCustomerFor } from "./shared.ts";

/** ilike treats % and _ as wildcards; escape them so an email only matches itself. */
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The verified customer's latest transactions and payouts, so "what's happening with my payout?"
 * can be answered without a reference. Customer-safe summaries only (no compliance reasoning).
 */
async function recentActivityFor(ctx: ToolContext, customerId: string) {
  const [tx, po] = await Promise.all([
    ctx.db.from("transactions").select("transaction_id, transaction_type, amount, currency, status, estimated_arrival, support_summary").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(5),
    ctx.db.from("payouts").select("payout_id, transaction_id, recipient_name, amount, currency, status, scheduled_for, failure_reason").eq("customer_id", customerId).order("scheduled_for", { ascending: false }).limit(5),
  ]);
  if (tx.error) throw new Error(tx.error.message);
  if (po.error) throw new Error(po.error.message);
  const transactions = (tx.data ?? []).map((t) => ({
    reference: t.transaction_id,
    type: t.transaction_type,
    amount: `${t.amount} ${t.currency}`,
    status: t.status,
    estimated_arrival: t.estimated_arrival,
    support_summary: String(t.support_summary ?? "").replace(/\s*Escalate account-specific questions\.?/i, "").trim(),
  }));
  const payouts = (po.data ?? []).map((p) => {
    const review = p.status === "review required" || /compliance/i.test(p.failure_reason ?? "");
    return {
      reference: p.payout_id,
      linked_transaction: p.transaction_id,
      recipient: p.recipient_name,
      amount: `${p.amount} ${p.currency}`,
      status: p.status,
      scheduled_for: p.scheduled_for,
      support_summary: review
        ? "On hold pending a review; a specialist needs to follow up."
        : p.status === "failed"
          ? `Failed: ${p.failure_reason ?? "details need review"}.`
          : `Payout is ${p.status}.`,
    };
  });
  return { transactions, payouts };
}

async function findCandidate(
  ctx: ToolContext,
  input: { customer_id?: string | undefined; email?: string | undefined; company_name?: string | undefined },
): Promise<CustomerRow | null> {
  const q = () => ctx.db.from("customers").select("*");
  if (input.customer_id) {
    const { data, error } = await q().eq("customer_id", normalizeCustomerId(input.customer_id)).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as CustomerRow;
  }
  if (input.email) {
    const { data, error } = await q().ilike("contact_email", escapeLike(normalizeEmail(input.email))).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as CustomerRow;
  }
  if (input.company_name) {
    // Spoken company names vary in spacing/case, so compare normalized forms. The table is small.
    const { data, error } = await q();
    if (error) throw new Error(error.message);
    const target = normalizeName(input.company_name);
    return ((data ?? []) as CustomerRow[]).find((c) => normalizeName(c.company_name) === target) ?? null;
  }
  return null;
}

export const lookupCustomer = defineTool({
  name: "lookup_customer",
  title: "Look up and verify a RelayPay customer",
  description:
    "Find a customer account and verify the caller's identity. Call it as soon as the caller says who they are " +
    "(for example \"I'm Amara from LagosLedger\") and pass every identifier they gave; do not ask for more details first, " +
    "because this tool decides whether they are enough. " +
    "The caller is verified only when at least two identifiers match (for example contact name plus company name, " +
    "or email plus company). Unverified results contain no account details. " +
    "Never read out support_notes, emails or IDs; support_notes are internal routing guidance only. " +
    "For verified callers the result also lists their recent transactions and payouts (recent_activity); use it only to help " +
    "confirm which payment the caller means after asking for the reference, never to assume it.",
  memberOnly: true,
  purpose: "Verify caller identity and fetch safe account status",
  inputSchema: {
    customer_id: z.string().max(40).optional().describe("Customer ID such as CUS-1001"),
    email: z.string().max(200).optional().describe("Account contact email, normalized from speech (e.g. amara@lagosledger.example)"),
    company_name: z.string().max(200).optional().describe("Registered company name"),
    contact_name: z.string().max(200).optional().describe("The caller's name as they said it"),
  },
  handler: async (input, ctx) => {
    if (!input.customer_id && !input.email && !input.company_name) {
      return {
        status: "denied",
        result: {
          found: false,
          verified: false,
          next_step: "Ask for the company name and the email address on the account.",
        },
      };
    }

    const customer = await findCandidate(ctx, input);
    if (!customer) {
      return {
        status: "not_found",
        result: {
          found: false,
          verified: false,
          next_step: "No matching account. Ask the caller to confirm the company name or account email; do not guess.",
        },
      };
    }

    // A conversation already verified for this customer (e.g. the caller is signed in to the
    // dashboard) counts as verified; otherwise at least two identifiers must match.
    const alreadyVerified = (await verifiedCustomerFor(ctx)) === customer.customer_id;
    const verification = alreadyVerified
      ? { verified: true, matched: ["customer_id" as const], mismatched: [] }
      : verifyIdentity(input, customer);
    if (!verification.verified) {
      return {
        status: "denied",
        summary: `found ${customer.customer_id}, not verified (matched: ${verification.matched.join(",") || "none"}; mismatched: ${verification.mismatched.join(",") || "none"})`,
        result: {
          found: true,
          verified: false,
          next_step:
            verification.mismatched.length > 0
              ? "The details given do not match our records. Do not share any account information. Ask the caller to double-check, or offer a specialist callback."
              : `Not enough to verify identity yet. ${nextFactorHint(verification)} Do not share account details until verified.`,
        },
      };
    }

    if (ctx.conversationId) {
      const { error } = await ctx.db
        .from("conversations")
        .update({ verified_customer_id: customer.customer_id })
        .eq("id", ctx.conversationId);
      if (error) ctx.log.warn({ error: error.message }, "could not record verified customer on conversation");
    }

    const needsHuman = customer.account_status !== "active" || customer.kyc_status !== "approved";
    const recentActivity = await recentActivityFor(ctx, customer.customer_id);
    return {
      status: "success",
      summary: `verified ${customer.customer_id} via ${alreadyVerified ? "signed-in session" : verification.matched.join("+")}; status=${customer.account_status}, kyc=${customer.kyc_status}`,
      result: {
        found: true,
        verified: true,
        customer_id: customer.customer_id,
        company_name: customer.company_name,
        contact_first_name: customer.contact_name.split(/\s+/)[0],
        plan: customer.plan,
        account_status: customer.account_status,
        kyc_status: customer.kyc_status,
        support_notes: customer.support_notes,
        support_notes_visibility: "internal — use for routing only, never read aloud",
        escalation_recommended: needsHuman,
        escalation_category: needsHuman ? (customer.kyc_status === "approved" ? "account" : "compliance") : null,
        recent_activity: recentActivity,
      },
    };
  },
});
