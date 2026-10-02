import "server-only";
import { timingSafeEqual } from "node:crypto";
import { db } from "./db";

export interface Customer {
  customer_id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  plan: string;
  account_status: string;
  region: string;
  kyc_status: string;
}

export interface Transaction {
  transaction_id: string;
  transaction_type: string;
  amount: number;
  currency: string;
  destination_country: string | null;
  status: string;
  created_at: string;
  estimated_arrival: string | null;
  support_summary: string;
}

export interface Payout {
  payout_id: string;
  transaction_id: string | null;
  recipient_name: string;
  amount: number;
  currency: string;
  status: string;
  scheduled_for: string | null;
  failure_reason: string | null;
}

// Internal support_notes are deliberately never selected for the customer-facing dashboard.
const CUSTOMER_COLUMNS = "customer_id, company_name, contact_name, contact_email, plan, account_status, region, kyc_status";

export const firstNameOf = (c: Pick<Customer, "contact_name">) => c.contact_name.trim().split(/\s+/)[0] ?? "";

/** Demo password rule: the contact's first name in lowercase followed by 123 (e.g. amara123). */
export const demoPasswordFor = (c: Pick<Customer, "contact_name">) => `${firstNameOf(c).toLowerCase()}123`;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Checks a login against the seed customers: the identifier is the contact email or the
 * contact's first name (case-insensitive). Returns the customer on success, otherwise null.
 */
/** Signs in by account email (unique per customer) and password. */
export async function authenticate(email: string, password: string): Promise<Customer | null> {
  const id = email.trim().toLowerCase();
  // Demo rule, so be forgiving: ignore capitalisation and stray spaces from autofill ("Efua123 ").
  password = password.trim().toLowerCase();
  if (!id || !password || !id.includes("@")) return null;
  // Exact match on the email; escape LIKE wildcards so "%" can't match other accounts.
  const { data, error } = await db().from("customers").select(CUSTOMER_COLUMNS).ilike("contact_email", id.replace(/[\\%_]/g, "\\$&")).maybeSingle();
  if (error) throw new Error(`customers lookup: ${error.message}`);
  const customer = (data as Customer | null) ?? undefined;
  // Compare even when no customer matched, so timing doesn't reveal which identifiers exist.
  const expected = customer ? demoPasswordFor(customer) : "no-such-customer-000";
  return safeEqual(password, expected) && customer ? customer : null;
}

export async function getCustomerOverview(customerId: string) {
  const [customer, transactions, payouts] = await Promise.all([
    db().from("customers").select(CUSTOMER_COLUMNS).eq("customer_id", customerId).maybeSingle(),
    db().from("transactions").select("transaction_id, transaction_type, amount, currency, destination_country, status, created_at, estimated_arrival, support_summary").eq("customer_id", customerId).order("created_at", { ascending: false }),
    db().from("payouts").select("payout_id, transaction_id, recipient_name, amount, currency, status, scheduled_for, failure_reason").eq("customer_id", customerId).order("scheduled_for", { ascending: false }),
  ]);
  for (const r of [customer, transactions, payouts]) if (r.error) throw new Error(r.error.message);
  if (!customer.data) return null;
  return {
    customer: customer.data as Customer,
    transactions: (transactions.data ?? []) as Transaction[],
    payouts: (payouts.data ?? []) as Payout[],
  };
}
