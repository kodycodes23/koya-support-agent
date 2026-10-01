import type { TransactionRow } from "@koya/shared";
import { z } from "zod";
import { defineTool } from "../define-tool.ts";
import { REDACTED_NOTE, isPast, normalizeRef, verifiedCustomerFor } from "./shared.ts";

const NEEDS_HUMAN = new Set(["review required", "failed"]);

export const lookupTransaction = defineTool({
  name: "lookup_transaction",
  title: "Look up a transaction by reference",
  description:
    "Get the real status of a transaction the caller gave a reference for (e.g. TXN-9001). Never guess a status. " +
    "Share the customer-safe support_summary; do not promise arrival beyond estimated_arrival. " +
    "Amount and currency are only returned when the caller is verified as the account owner. " +
    "If escalation_recommended is true, offer a specialist instead of troubleshooting.",
  purpose: "Report the real status of a customer-referenced transaction",
  inputSchema: {
    transaction_id: z.string().min(3).max(40).describe("Transaction reference such as TXN-9001"),
  },
  handler: async ({ transaction_id }, ctx) => {
    const ref = normalizeRef("TXN", transaction_id);
    // Record and verification state are independent: fetch both in one round trip of wall time.
    const [{ data, error }, verifiedAs] = await Promise.all([
      ctx.db.from("transactions").select("*").eq("transaction_id", ref).maybeSingle(),
      verifiedCustomerFor(ctx),
    ]);
    if (error) throw new Error(error.message);
    if (!data) {
      return {
        status: "not_found",
        result: {
          found: false,
          transaction_id: ref,
          next_step: "No transaction with that reference. Ask the caller to read the reference again; do not guess a status.",
        },
      };
    }
    const tx = data as TransactionRow;
    const owner = verifiedAs === tx.customer_id;
    const now = ctx.now();
    const escalate = NEEDS_HUMAN.has(tx.status) || /escalate/i.test(tx.support_summary);

    return {
      status: "success",
      summary: `${tx.transaction_id} status=${tx.status} owner_verified=${owner}`,
      result: {
        found: true,
        transaction_id: tx.transaction_id,
        type: tx.transaction_type,
        status: tx.status,
        estimated_arrival: tx.estimated_arrival,
        estimated_arrival_has_passed: tx.status !== "completed" && isPast(tx.estimated_arrival, now),
        support_summary: tx.support_summary.replace(/\s*Escalate account-specific questions\.?/i, "").trim(),
        caller_verified_as_owner: owner,
        ...(owner
          ? { customer_id: tx.customer_id, amount: String(tx.amount), currency: tx.currency, destination_country: tx.destination_country }
          : { redacted: true, redaction_note: REDACTED_NOTE }),
        escalation_recommended: escalate,
        escalation_category: escalate ? (tx.status === "review required" ? "compliance" : "payment") : null,
        today: now.toISOString().slice(0, 10),
      },
    };
  },
});
