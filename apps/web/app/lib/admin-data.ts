import "server-only";
import { db } from "./db";

export type CaseKind = "escalation" | "ticket";
export type CaseStatus = "open" | "pending" | "in_progress" | "closed";
export const STATUS_FILTERS = ["all", "open", "pending", "closed"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export interface CaseRow {
  id: string;
  kind: CaseKind;
  ref: string;
  status: CaseStatus;
  category: string;
  priority: string | null;
  createdAt: string;
  summary: string;
  customerId: string | null;
  customerName: string | null;
  company: string | null;
  email: string | null;
  preferredTime: string | null;
  followUp: string | null;
  transactionId: string | null;
  conversationId: string | null;
  source: "Voice call" | "Text chat" | "Test run" | "Callback form" | "Unknown";
  /** Times the customer got in touch again about this case (repeat contacts). */
  repeats: number;
}

export interface CaseCounts {
  open: number;
  pending: number;
  closed: number;
  total: number;
}

const LIMIT = 200;

/** Cases for the admin page, newest first, with customer names and repeat-contact counts. Never reads support_notes. */
export async function listCases(kind: CaseKind, filter: StatusFilter): Promise<CaseRow[]> {
  const table = kind === "escalation" ? "escalations" : "support_tickets";
  let query = db().from(table).select("*").order("created_at", { ascending: false }).limit(LIMIT);
  if (filter === "open") query = query.in("status", ["open", "in_progress"]);
  else if (filter !== "all") query = query.eq("status", filter);
  const { data, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  const rows = (data ?? []) as Record<string, unknown>[];

  const customerIds = [...new Set(rows.map((r) => r.customer_id as string | null).filter((v): v is string => Boolean(v)))];
  const refColumn = kind === "escalation" ? "escalation_ref" : "ticket_ref";
  const refs = rows.map((r) => r[refColumn] as string);
  const conversationIds = [...new Set(rows.map((r) => r.conversation_id as string | null).filter((v): v is string => Boolean(v)))];
  const [customers, repeats, conversations] = await Promise.all([
    customerIds.length
      ? db().from("customers").select("customer_id, contact_name, contact_email, company_name").in("customer_id", customerIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    refs.length
      ? db().from("conversation_events").select("metadata").eq("event_type", "repeat_contact").in(`metadata->>${refColumn}`, refs)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    conversationIds.length
      ? db().from("conversations").select("id, channel").in("id", conversationIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const channelOf = new Map(((conversations.data ?? []) as { id: string; channel: string }[]).map((c) => [c.id, c.channel]));
  const SOURCE: Record<string, CaseRow["source"]> = { voice: "Voice call", text: "Text chat", eval: "Test run" };
  const byId = new Map(((customers.data ?? []) as Record<string, string>[]).map((c) => [c.customer_id, c]));
  const repeatCount = new Map<string, number>();
  for (const e of (repeats.data ?? []) as { metadata: Record<string, string> }[]) {
    const ref = e.metadata?.[refColumn];
    if (ref) repeatCount.set(ref, (repeatCount.get(ref) ?? 0) + 1);
  }

  return rows.map((r) => {
    const customer = r.customer_id ? byId.get(r.customer_id as string) : undefined;
    const ref = r[refColumn] as string;
    const isEscalation = kind === "escalation";
    return {
      id: r.id as string,
      kind,
      ref,
      status: r.status as CaseStatus,
      category: r.category as string,
      priority: isEscalation ? null : (r.priority as string),
      createdAt: r.created_at as string,
      summary: String((isEscalation ? r.reason : r.summary) ?? ""),
      customerId: (r.customer_id as string | null) ?? null,
      customerName: (isEscalation ? (r.user_name as string) : customer?.contact_name) ?? customer?.contact_name ?? null,
      company: customer?.company_name ?? null,
      email: (isEscalation ? (r.user_email as string) : customer?.contact_email) ?? null,
      preferredTime: isEscalation ? ((r.preferred_time as string | null) ?? null) : null,
      followUp: isEscalation ? ((r.follow_up_summary as string | null) ?? null) : null,
      transactionId: isEscalation ? null : ((r.transaction_id as string | null) ?? null),
      conversationId: (r.conversation_id as string | null) ?? null,
      source: r.conversation_id ? (SOURCE[channelOf.get(r.conversation_id as string) ?? ""] ?? "Unknown") : isEscalation ? "Callback form" : "Unknown",
      repeats: repeatCount.get(ref) ?? 0,
    };
  });
}

/** Status counts for both tables (in progress counts as open). */
export async function caseCounts(): Promise<Record<CaseKind, CaseCounts>> {
  const count = async (table: string): Promise<CaseCounts> => {
    const { data, error } = await db().from(table).select("status").limit(10_000);
    if (error) throw new Error(`${table}: ${error.message}`);
    const c = { open: 0, pending: 0, closed: 0, total: 0 };
    for (const { status } of (data ?? []) as { status: string }[]) {
      c.total += 1;
      if (status === "pending") c.pending += 1;
      else if (status === "closed") c.closed += 1;
      else c.open += 1;
    }
    return c;
  };
  const [escalation, ticket] = await Promise.all([count("escalations"), count("support_tickets")]);
  return { escalation, ticket };
}
