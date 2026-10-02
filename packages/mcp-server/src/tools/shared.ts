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

/**
 * A guest is someone on RelayPay's public website (voice or chat) who hasn't signed in, or a test
 * conversation flagged as one. Guests get general knowledge only: no account tools at all.
 */
export async function isGuest(ctx: ToolContext): Promise<boolean> {
  if (!ctx.conversationId) return false;
  const { data, error } = await ctx.db
    .from("conversations")
    .select("channel, verified_customer_id, metadata")
    .eq("id", ctx.conversationId)
    .maybeSingle();
  if (error) throw new Error(`conversations lookup: ${error.message}`);
  if (!data || data.verified_customer_id) return false;
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  return data.channel === "voice" || data.channel === "chat" || metadata.guest === true;
}

export const GUEST_NEXT_STEP =
  "This caller is a guest on RelayPay's public website and is not signed in, so no account information is available. " +
  "Ask whether they already have a RelayPay account. If yes, call request_sign_in. If not, offer to have the onboarding team call them.";

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
