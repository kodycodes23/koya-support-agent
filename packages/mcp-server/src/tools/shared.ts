import type { ToolContext } from "../context.ts";

/** The customer this conversation has verified as, if any (set by lookup_customer). */
export async function verifiedCustomerFor(ctx: ToolContext): Promise<string | null> {
  if (!ctx.conversationId) return null;
  const { data, error } = await ctx.db
    .from("conversations")
    .select("verified_customer_id")
    .eq("id", ctx.conversationId)
    .maybeSingle();
  if (error) throw new Error(`conversations lookup: ${error.message}`);
  return (data?.verified_customer_id as string | null | undefined) ?? null;
}

/** Normalizes spoken references: "txn 9001", "TXN9001" -> "TXN-9001". */
export function normalizeRef(prefix: "TXN" | "PAY" | "TKT", value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits ? `${prefix}-${digits}` : value.trim().toUpperCase();
}

/** True when an ISO date (YYYY-MM-DD) is strictly before today (UTC). */
export function isPast(date: string | null, now: Date): boolean {
  if (!date) return false;
  return date < now.toISOString().slice(0, 10);
}

export const REDACTED_NOTE =
  "Amount, currency and recipient are withheld because the caller has not verified they own this account. Do not guess them.";
