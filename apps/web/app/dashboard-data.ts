/**
 * Demo figures for the dashboard. Balances and invoices are not part of the RelayPay seed
 * data, so they are generated per customer (stable for a given customer ID) and the page
 * labels them as demo data. Transactions and payouts come from Supabase.
 */

export type Tone = "navy" | "light" | "teal";

const LOCAL_CURRENCY: Record<string, { code: string; name: string }> = {
  Nigeria: { code: "NGN", name: "Naira account" },
  Kenya: { code: "KES", name: "Shilling account" },
  Ghana: { code: "GHS", name: "Cedi account" },
  "South Africa": { code: "ZAR", name: "Rand account" },
  Rwanda: { code: "RWF", name: "Franc account" },
};

// Rough demo magnitudes per currency so balances look plausible.
const SCALE: Record<string, number> = { USD: 1, EUR: 0.4, NGN: 950, KES: 80, GHS: 9, ZAR: 12, RWF: 800 };

/** Small deterministic hash so each customer always sees the same demo numbers. */
function seed(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol", // "$9,460.00" rather than "US$9,460.00"
    maximumFractionDigits: amount >= 100_000 ? 0 : 2,
  }).format(amount);
}

export function localCurrency(region: string) {
  return LOCAL_CURRENCY[region] ?? { code: "USD", name: "US dollar account" };
}

export function demoWallets(customerId: string, region: string) {
  const local = localCurrency(region);
  const accounts: { code: string; name: string; tone: Tone }[] = [
    { code: "USD", name: "US dollar account", tone: "navy" },
    { code: "EUR", name: "Euro account", tone: "light" },
    ...(local.code === "USD" ? [] : [{ ...local, tone: "teal" as Tone }]),
  ];
  return accounts.map((a, i) => {
    const amount = Math.round((6000 + seed(customerId, i) * 20000) * (SCALE[a.code] ?? 1) * 100) / 100;
    return { ...a, balance: money(amount, a.code), last4: String(1000 + Math.floor(seed(customerId, i + 10) * 8999)) };
  });
}

const CLIENTS = ["Northwind GmbH", "Harbor & Pine LLC", "Kora Foods", "Atlas Freight", "Blue Mesa Studio", "Oakline Retail"];

export function demoInvoices(customerId: string, region: string) {
  const local = localCurrency(region).code;
  const plan: { currency: string; status: "sent" | "paid" | "draft"; due: string }[] = [
    { currency: "EUR", status: "sent", due: "Due 30 Sep" },
    { currency: "USD", status: "paid", due: "Paid 12 Sep" },
    { currency: local, status: "draft", due: "Draft" },
  ];
  const firstClient = Math.floor(seed(customerId, 40) * CLIENTS.length);
  return plan.map((p, i) => {
    const amount = Math.round((1500 + seed(customerId, 20 + i) * 6000) * (SCALE[p.currency] ?? 1));
    return {
      number: `INV-${2040 + Math.floor(seed(customerId, 30 + i) * 60)}`,
      client: CLIENTS[(firstClient + i * 2) % CLIENTS.length]!, // distinct clients per customer
      amount: money(amount, p.currency),
      due: p.due,
      status: p.status,
    };
  });
}
