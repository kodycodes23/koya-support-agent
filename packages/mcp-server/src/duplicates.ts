import { REPEAT_WINDOW_HOURS, sameIssue, since, type IssueKey } from "@koya/shared";
import type { ToolContext } from "./context.ts";

type Row = Record<string, unknown>;

export interface OpenCase {
  row: Row;
  /** "duplicate": already created on this call. "repeat": an earlier call's open case for the same issue. */
  kind: "duplicate" | "repeat";
}

/**
 * Finds an open ticket or escalation for the same issue: first on this call, then (for a known
 * customer or email) on earlier calls within REPEAT_WINDOW_HOURS. Eval conversations only check
 * their own call, so test runs never pick up each other's (or real customers') cases.
 */
export async function findOpenCase(
  ctx: ToolContext,
  opts: {
    table: "support_tickets" | "escalations";
    issue: IssueKey;
    issueOf: (row: Row) => IssueKey;
    owner: { column: "customer_id" | "user_email"; value: string } | null;
  },
): Promise<OpenCase | null> {
  const newestMatch = (rows: Row[], strict: boolean) =>
    rows
      .filter((r) => r.status !== "closed" && sameIssue(opts.issue, opts.issueOf(r), { strict }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;

  if (ctx.conversationId) {
    const { data, error } = await ctx.db.from(opts.table).select("*").eq("conversation_id", ctx.conversationId);
    if (error) throw new Error(`${opts.table} duplicate check: ${error.message}`);
    const row = newestMatch((data ?? []) as Row[], false);
    if (row) return { row, kind: "duplicate" };
  }

  if (!opts.owner || (await conversationChannel(ctx)) === "eval") return null;
  const { data, error } = await ctx.db
    .from(opts.table)
    .select("*")
    .eq(opts.owner.column, opts.owner.value)
    .neq("status", "closed")
    .gte("created_at", since(ctx.now(), REPEAT_WINDOW_HOURS * 60))
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`${opts.table} repeat check: ${error.message}`);
  const row = newestMatch(((data ?? []) as Row[]).filter((r) => r.conversation_id !== ctx.conversationId), true);
  return row ? { row, kind: "repeat" } : null;
}

async function conversationChannel(ctx: ToolContext): Promise<string | null> {
  if (!ctx.conversationId) return null;
  const { data } = await ctx.db.from("conversations").select("channel").eq("id", ctx.conversationId).maybeSingle();
  return (data?.channel as string | undefined) ?? null;
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` after any earlier call with the same key has finished, so two identical tool calls
 * arriving together (parallel or retried) can't both pass the duplicate check. One process only;
 * a multi-instance deploy would need a database constraint as well.
 */
export async function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  try {
    return await run;
  } finally {
    if (queues.get(key) === tail) queues.delete(key);
  }
}

/** Customer-friendly date for a reused case, e.g. "Monday, September 28". */
export function spokenDate(iso: unknown): string {
  const d = new Date(String(iso));
  return Number.isNaN(d.getTime()) ? "earlier" : new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(d);
}
