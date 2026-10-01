/**
 * Minimal in-memory stand-in for the parts of the Supabase client the tools use:
 * from(t).select/eq/neq/gte/ilike/limit/maybeSingle/single, insert(...).select().single(),
 * update(...).eq(...), and rpc('search_kb_chunks_fts'). Seeded from the real CSVs and KB.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import type { SupabaseClient } from "@koya/shared";
import { chunkKnowledgeBase } from "../../../supabase/seed/chunk-kb.ts";

type Row = Record<string, unknown>;
const ASSETS = new URL("../../../assets/", import.meta.url);

function csv(file: string): Row[] {
  const rows = parse(readFileSync(new URL(`seed-data/${file}`, ASSETS), "utf8"), { columns: true, skip_empty_lines: true }) as Row[];
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === "" ? null : v])));
}

export function createFakeDb() {
  const tables: Record<string, Row[]> = {
    customers: csv("customers.csv"),
    transactions: csv("transactions.csv").map((r) => ({ ...r, amount: Number(r.amount) })),
    payouts: csv("payouts.csv").map((r) => ({ ...r, amount: Number(r.amount) })),
    kb_chunks: chunkKnowledgeBase(readFileSync(new URL("relaypay-knowledge-base.md", ASSETS), "utf8")).map((c) => ({ id: randomUUID(), ...c })),
    conversations: [],
    tool_call_logs: [],
    retrieval_logs: [],
    support_tickets: [],
    escalations: [],
    conversation_events: [],
  };
  let ticketSeq = 1001;
  let escalationSeq = 5001;

  const defaults = (table: string, row: Row): Row => {
    const base: Row = { id: randomUUID(), created_at: new Date().toISOString(), ...row };
    if (table === "support_tickets") return { ticket_ref: `TKT-${ticketSeq++}`, status: "open", ...base };
    if (table === "escalations") return { escalation_ref: `ESC-${escalationSeq++}`, status: "open", ...base };
    return base;
  };

  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: { kind: "select" } | { kind: "insert"; rows: Row[] } | { kind: "update"; patch: Row } = { kind: "select" };
    let max = Infinity;
    const rows = () => (tables[table] ??= []);

    const exec = (): { data: Row[]; error: null } => {
      if (op.kind === "insert") {
        const inserted = op.rows.map((r) => defaults(table, r));
        rows().push(...inserted);
        return { data: inserted, error: null };
      }
      const matched = rows().filter((r) => filters.every((f) => f(r)));
      if (op.kind === "update") matched.forEach((r) => Object.assign(r, (op as { patch: Row }).patch));
      return { data: matched.slice(0, max), error: null };
    };

    const api = {
      select: () => api,
      eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), api),
      ilike: (col: string, pattern: string) => {
        const target = pattern.replace(/\\(.)/g, "$1").toLowerCase();
        filters.push((r) => String(r[col]).toLowerCase() === target);
        return api;
      },
      neq: (col: string, val: unknown) => (filters.push((r) => r[col] !== val), api),
      gte: (col: string, val: string) => (filters.push((r) => String(r[col]) >= val), api),
      limit: (n: number) => ((max = n), api),
      order: () => api,
      insert: (value: Row | Row[]) => ((op = { kind: "insert", rows: Array.isArray(value) ? value : [value] }), api),
      update: (patch: Row) => ((op = { kind: "update", patch }), api),
      maybeSingle: async () => ({ data: exec().data[0] ?? null, error: null }),
      single: async () => {
        const { data } = exec();
        return data[0] ? { data: data[0], error: null } : { data: null, error: { message: "no rows" } };
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve(exec()),
    };
    return api;
  }

  function rpc(fn: string, args: Row) {
    if (fn !== "search_kb_chunks_fts") return Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}` } });
    const terms = String(args.query_text).toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const scored = tables.kb_chunks!
      .map((c) => {
        const hay = `${c.section} ${c.section} ${c.content}`.toLowerCase();
        return { ...c, score: terms.reduce((s, t) => s + (hay.includes(t.slice(0, 5)) ? 1 : 0), 0) / 10 };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Number(args.match_count ?? 4));
    return Promise.resolve({ data: scored, error: null });
  }

  const client = { from: builder, rpc } as unknown as SupabaseClient;
  return { client, tables };
}
