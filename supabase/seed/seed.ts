/**
 * Loads assets/seed-data/{customers,transactions,payouts}.csv into Supabase.
 * Idempotent: upserts on the primary key, so it is safe to re-run.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { createLogger, createServiceClient, type CustomerRow, type PayoutRow, type TransactionRow } from "@koya/shared";
import { env } from "./env.ts";

const log = createLogger("seed", env.LOG_LEVEL);
const db = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function readCsv(file: string): Promise<Record<string, string>[]> {
  const raw = await readFile(join(env.ASSETS_DIR, "seed-data", file), "utf8");
  return parse(raw, { columns: true, skip_empty_lines: true, trim: true });
}

const nullIfEmpty = (v: string | undefined) => (v === undefined || v === "" ? null : v);

async function upsert(table: string, rows: object[], onConflict: string) {
  const { error, count } = await db.from(table).upsert(rows, { onConflict, count: "exact" });
  if (error) throw new Error(`${table}: ${error.message}`);
  log.info({ table, rows: count ?? rows.length }, "upserted");
}

async function main() {
  const customers: CustomerRow[] = (await readCsv("customers.csv")).map((r) => ({
    customer_id: r.customer_id!,
    company_name: r.company_name!,
    contact_name: r.contact_name!,
    contact_email: r.contact_email!,
    plan: r.plan!,
    account_status: r.account_status!,
    region: r.region!,
    kyc_status: r.kyc_status!,
    support_notes: r.support_notes ?? "",
  }));

  const transactions: TransactionRow[] = (await readCsv("transactions.csv")).map((r) => ({
    transaction_id: r.transaction_id!,
    customer_id: r.customer_id!,
    transaction_type: r.transaction_type!,
    amount: Number(r.amount),
    currency: r.currency!,
    destination_country: nullIfEmpty(r.destination_country),
    status: r.status!,
    created_at: r.created_at!,
    estimated_arrival: nullIfEmpty(r.estimated_arrival),
    support_summary: r.support_summary ?? "",
  }));

  const payouts: PayoutRow[] = (await readCsv("payouts.csv")).map((r) => ({
    payout_id: r.payout_id!,
    transaction_id: nullIfEmpty(r.transaction_id),
    customer_id: r.customer_id!,
    recipient_name: r.recipient_name!,
    amount: Number(r.amount),
    currency: r.currency!,
    status: r.status!,
    scheduled_for: nullIfEmpty(r.scheduled_for),
    failure_reason: nullIfEmpty(r.failure_reason),
  }));

  // FK order matters: customers → transactions → payouts.
  await upsert("customers", customers, "customer_id");
  await upsert("transactions", transactions, "transaction_id");
  await upsert("payouts", payouts, "payout_id");
  log.info("seed complete");
}

main().catch((err: unknown) => {
  log.error({ err }, "seed failed");
  process.exit(1);
});
