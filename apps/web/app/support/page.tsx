import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "../lib/db";
import { getSession, IDLE_TIMEOUT_SECONDS } from "../lib/session";
import { SupportExperience, type SignedInCaller } from "../support-experience";

export const metadata: Metadata = {
  title: "RelayPay Support · Talk to Koya",
  description: "Speak with Koya, RelayPay's voice support assistant.",
};

/** The signed-in customer, so the page can say Koya will recognise them. */
async function signedInCaller(customerId: string): Promise<SignedInCaller | null> {
  try {
    const { data } = await db().from("customers").select("contact_name, company_name").eq("customer_id", customerId).maybeSingle();
    return data
      ? { firstName: String(data.contact_name).split(/\s+/)[0] ?? "", fullName: String(data.contact_name), company: String(data.company_name) }
      : null;
  } catch {
    return null;
  }
}

export default async function SupportPage() {
  // Koya is only available to signed-in customers.
  const session = await getSession();
  if (!session) redirect("/");
  return <SupportExperience signedIn={await signedInCaller(session.customerId)} idleTimeoutSeconds={IDLE_TIMEOUT_SECONDS} />;
}
