import type { CustomerRow } from "@koya/shared";

/**
 * Identity verification for account-specific lookups.
 *
 * A caller is verified when at least TWO independent identifiers they supplied match
 * the same customer record and none of the supplied identifiers contradicts it.
 * Identifiers supported by the seed data: customer_id, contact email, company name,
 * contact name (full or first name — callers usually say "I'm Amara").
 */
export interface IdentityClaim {
  customer_id?: string | undefined;
  email?: string | undefined;
  company_name?: string | undefined;
  contact_name?: string | undefined;
}

export type Factor = keyof IdentityClaim;

export interface VerificationResult {
  verified: boolean;
  matched: Factor[];
  mismatched: Factor[];
}

export const MIN_FACTORS = 2;

/** Lowercase and strip everything but letters/digits: "Lagos Ledger" == "LagosLedger". */
export function normalizeName(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeCustomerId(value: string): string {
  // Speech-to-text often yields "cus 1001" or "CUS1001".
  const digits = value.replace(/\D/g, "");
  return digits ? `CUS-${digits}` : value.trim().toUpperCase();
}

function contactNameMatches(claimed: string, actual: string): boolean {
  const claimedParts = claimed.toLowerCase().split(/\s+/).map(normalizeName).filter(Boolean);
  const actualParts = actual.toLowerCase().split(/\s+/).map(normalizeName).filter(Boolean);
  if (claimedParts.length === 0) return false;
  // Every word the caller said must be part of the contact's name ("Amara", "Amara Okafor").
  return claimedParts.every((p) => actualParts.includes(p));
}

export function verifyIdentity(claim: IdentityClaim, customer: CustomerRow): VerificationResult {
  const matched: Factor[] = [];
  const mismatched: Factor[] = [];
  const check = (factor: Factor, ok: boolean) => (ok ? matched : mismatched).push(factor);

  if (claim.customer_id) check("customer_id", normalizeCustomerId(claim.customer_id) === customer.customer_id);
  if (claim.email) check("email", normalizeEmail(claim.email) === normalizeEmail(customer.contact_email));
  if (claim.company_name) check("company_name", normalizeName(claim.company_name) === normalizeName(customer.company_name));
  if (claim.contact_name) check("contact_name", contactNameMatches(claim.contact_name, customer.contact_name));

  return { verified: matched.length >= MIN_FACTORS && mismatched.length === 0, matched, mismatched };
}

/** Which identifier to ask for next, phrased for the agent. */
export function nextFactorHint(result: VerificationResult): string {
  const have = new Set(result.matched);
  if (!have.has("email")) return "Ask for the email address on the account.";
  if (!have.has("company_name")) return "Ask for the registered company name.";
  if (!have.has("customer_id")) return "Ask for the customer ID.";
  return "Ask for the account contact's name.";
}
