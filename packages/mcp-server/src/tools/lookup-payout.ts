import type { PayoutRow } from "@koya/shared";
import { z } from "zod";
import { defineTool } from "../define-tool.ts";
import { REDACTED_NOTE, isPast, normalizeRef, verifiedCustomerFor } from "./shared.ts";

export const lookupPayout = defineTool({
  name: "lookup_payout",
  title: "Look up a contractor or vendor payout",
  description:
    "Get the real status of a payout by payout reference (e.g. PAY-7002) or its linked transaction reference. " +
    "Never guess a status or promise a date. Recipient and amount are only returned for verified account owners. " +
    "If escalation_recommended is true (for example a compliance review), escalate to a specialist and do not explain internal compliance decisions.",
  memberOnly: true,
  purpose: "Report the real status of a payout",
  inputSchema: {
    payout_id: z.string().max(40).optional().describe("Payout reference such as PAY-7002"),
    transaction_id: z.string().max(40).optional().describe("Linked transaction reference such as TXN-9003"),
  },
  handler: async ({ payout_id, transaction_id }, ctx) => {
    if (!payout_id && !transaction_id) {
      return { status: "denied", result: { found: false, next_step: "Ask for the payout reference or the transaction reference." } };
    }
    let query = ctx.db.from("payouts").select("*").limit(1);
    query = payout_id
      ? query.eq("payout_id", normalizeRef("PAY", payout_id))
      : query.eq("transaction_id", normalizeRef("TXN", transaction_id!));
    const [{ data, error }, verifiedAs] = await Promise.all([query.maybeSingle(), verifiedCustomerFor(ctx)]);
    if (error) throw new Error(error.message);
    if (!data) {
      return {
        status: "not_found",
        result: {
          found: false,
          next_step: "No payout matches that reference. Ask the caller to confirm it; do not guess a status.",
        },
      };
    }
    const payout = data as PayoutRow;
    const owner = verifiedAs === payout.customer_id;
    const now = ctx.now();
    const compliance = payout.status === "review required" || /compliance/i.test(payout.failure_reason ?? "");
    const escalate = compliance || payout.status === "failed";

    const supportSummary = compliance
      ? "This payout is on hold pending a compliance review. A specialist needs to follow up; the review details cannot be shared."
      : payout.status === "failed"
        ? `This payout failed${payout.failure_reason ? ` because the ${payout.failure_reason}` : ""}. A specialist can help resolve it.`
        : payout.status === "completed"
          ? "This payout has completed."
          : `This payout is ${payout.status}${payout.scheduled_for ? `, scheduled for ${payout.scheduled_for}` : ""}.`;

    return {
      status: "success",
      summary: `${payout.payout_id} status=${payout.status} owner_verified=${owner}`,
      result: {
        found: true,
        payout_id: payout.payout_id,
        transaction_id: payout.transaction_id,
        status: payout.status,
        scheduled_for: payout.scheduled_for,
        scheduled_date_has_passed: !["completed", "failed"].includes(payout.status) && isPast(payout.scheduled_for, now),
        failure_reason: compliance ? "under review" : payout.failure_reason,
        support_summary: supportSummary,
        caller_verified_as_owner: owner,
        ...(owner
          ? { recipient_name: payout.recipient_name, amount: String(payout.amount), currency: payout.currency }
          : { redacted: true, redaction_note: REDACTED_NOTE }),
        escalation_recommended: escalate,
        escalation_category: escalate ? (compliance ? "compliance" : "payment") : null,
        today: now.toISOString().slice(0, 10),
      },
    };
  },
});
