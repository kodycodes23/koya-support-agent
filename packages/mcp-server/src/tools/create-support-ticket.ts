import { TICKET_CATEGORIES, TICKET_PRIORITIES } from "@koya/shared";
import { z } from "zod";
import { defineTool } from "../define-tool.ts";
import { resolveConversationId, type ToolContext } from "../context.ts";
import { normalizeRef } from "./shared.ts";

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
    "Tell the caller the ticket number after creating it.",
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
    const { data, error } = await ctx.db
      .from("support_tickets")
      .insert({
        conversation_id: resolveConversationId(ctx, input.conversation_id),
        customer_id: customerId,
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
  },
});
