import type { Metadata } from "next";
import { db } from "../lib/db";
import { getSession, IDLE_TIMEOUT_SECONDS } from "../lib/session";
import { SupportExperience, type SignedInCaller } from "../support-experience";

export const metadata: Metadata = {
  title: "RelayPay Support · Talk to Koya",
  description: "Speak with Koya, RelayPay's voice support assistant.",
};

/**
 * The signed-in customer, so the page can greet them, plus "Try asking" prompts that use their
 * own latest transaction and payout (never another customer's references).
 */
async function signedInCaller(customerId: string): Promise<SignedInCaller | null> {
  try {
    const [customer, transaction, payout] = await Promise.all([
      db().from("customers").select("contact_name, company_name, contact_email").eq("customer_id", customerId).maybeSingle(),
      db().from("transactions").select("transaction_id").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db().from("payouts").select("payout_id").eq("customer_id", customerId).order("scheduled_for", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const c = customer.data;
    if (!c) return null;
    const suggestions = [
      "What fees does RelayPay charge?",
      transaction.data ? `Check transaction ${transaction.data.transaction_id}` : "How long do international payments take?",
      payout.data ? `What's happening with payout ${payout.data.payout_id}?` : "Why would a payment be delayed?",
    ];
    return {
      firstName: String(c.contact_name).split(/\s+/)[0] ?? "",
      fullName: String(c.contact_name),
      company: String(c.company_name),
      email: String(c.contact_email),
      suggestions,
    };
  } catch {
    return null;
  }
}

export default async function SupportPage() {
  // Open to everyone: guests get general help; signed-in customers get help with their own account.
  const session = await getSession();
  return <SupportExperience signedIn={session ? await signedInCaller(session.customerId) : null} idleTimeoutSeconds={IDLE_TIMEOUT_SECONDS} />;
}
