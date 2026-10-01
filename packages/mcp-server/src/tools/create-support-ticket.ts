import { TICKET_CATEGORIES, TICKET_PRIORITIES, referencesIn } from "@koya/shared";
import { inBackground } from "../background.ts";
import { z } from "zod";
import { defineTool } from "../define-tool.ts";
import { resolveConversationId, type ToolContext } from "../context.ts";
import { findOpenCase, serialized, spokenDate } from "../duplicates.ts";
import { normalizeRef, verifiedCustomerFor } from "./shared.ts";

/** Drops references that do not exist so a mistyped ID never fails the insert on a foreign key. */
async function existing(ctx: ToolContext, table: string, column: string, value: string | undefined): Promise<string | null> {
  if (!value) return null;
  const { data, error } = await ctx.db.from(table).select(column).eq(column, value).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? value : null;
}

export const createSupportTicket = defineTool({
  name: "create_support_ticket",
  title: "Create a support ticket",
  description:
    "Log an issue for the RelayPay support team to follow up, such as a failed invoice payment or a question the " +
    "knowledge base cannot answer. Get the relevant reference first if the caller has one. " +
    "Tell the caller the ticket number after creating it. If the caller already has an open ticket for the same issue, it is " +
    "reused (already_open true) instead of creating another.",
  purpose: "Log an issue for human support follow-up",
  inputSchema: {
    category: z.enum(TICKET_CATEGORIES),
    priority: z.enum(TICKET_PRIORITIES),
    summary: z.string().min(5).max(1000).describe("Customer-safe description of the issue and what they need"),
    customer_id: z.string().max(40).optional(),
    transaction_id: z.string().max(40).optional().describe("Related transaction reference, if any"),
    conversation_id: z.string().max(64).optional().describe("Do not include this field. The server fills it in."),
  },
  handler: async (input, ctx) => {
    const [customerId, transactionId] = await Promise.all([
      existing(ctx, "customers", "customer_id", input.customer_id?.toUpperCase()),
      existing(ctx, "transactions", "transaction_id", input.transaction_id ? normalizeRef("TXN", input.transaction_id) : undefined),
    ]);
    const conversationId = resolveConversationId(ctx, input.conversation_id);
    // A ticket on this call reached via a verified caller counts as theirs even without customer_id.
    const ownerId = customerId ?? (await verifiedCustomerFor(ctx));
    const issue = { category: input.category, refs: referencesIn(input.summary, transactionId) };

    return serialized(`case:${ownerId ?? conversationId ?? "anonymous"}`, async () => {
      const open = await findOpenCase(ctx, {
        table: "support_tickets",
        issue,
        issueOf: (r) => ({ category: String(r.category), refs: referencesIn(String(r.summary ?? ""), r.transaction_id as string | null) }),
        owner: ownerId ? { column: "customer_id", value: ownerId } : null,
      });
      if (open) {
        const ref = open.row.ticket_ref as string;
        const repeat = open.kind === "repeat";
        inBackground(ctx.log, "conversation_events", ctx.db.from("conversation_events").insert({
          conversation_id: ctx.conversationId,
          event_type: repeat ? "repeat_contact" : "duplicate_prevented",
          summary: repeat ? `Caller got in touch again about ${ref}: ${input.summary}`.slice(0, 500) : `create_support_ticket repeated on the same call; reused ${ref}`,
          metadata: { ticket_ref: ref, opened_at: open.row.created_at },
        }));
        return {
          status: "success",
          result: {
            ticket_id: ref,
            status: open.row.status as string,
            already_open: true,
            ...(repeat ? { opened: spokenDate(open.row.created_at) } : {}),
            next_step: repeat
              ? `The caller already has an open ticket for this, ${ref}, opened ${spokenDate(open.row.created_at)}. No new ticket was created. Tell them the number, that it is still open and that you've noted they called again. Do not promise a timeline.`
              : "This ticket was already created on this call. Do not create another; confirm the existing ticket number in one sentence.",
          },
        };
      }

      const { data, error } = await ctx.db
        .from("support_tickets")
        .insert({
          conversation_id: conversationId,
          customer_id: ownerId,
          transaction_id: transactionId,
          category: input.category,
          priority: input.priority,
          summary: input.summary,
        })
        .select("ticket_ref, status")
        .single();
      if (error) throw new Error(error.message);
      return {
        status: "success",
        result: {
          ticket_id: data.ticket_ref as string,
          status: data.status as string,
          next_step: "Tell the caller their ticket number and that the support team will follow up. Do not promise a timeline.",
        },
      };
    });
  },
});
