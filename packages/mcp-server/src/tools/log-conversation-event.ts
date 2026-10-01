import { z } from "zod";
import { defineTool } from "../define-tool.ts";
import { resolveConversationId } from "../context.ts";

export const logConversationEvent = defineTool({
  name: "log_conversation_event",
  title: "Log an agent decision",
  description:
    "Record an important decision that no other tool captures, such as declining an unsupported request or " +
    "identity verification failing. Do not use it for routine answers, escalations or tickets (those tools log themselves), " +
    "and never call it in a reply where you ask the caller a question. Tool calls are already logged automatically.",
  purpose: "Record important agent actions and decisions",
  inputSchema: {
    event_type: z.string().min(2).max(60).describe("e.g. declined_unsupported, verification_failed, customer_frustrated"),
    summary: z.string().min(2).max(500),
    metadata: z.record(z.string(), z.unknown()).optional(),
    conversation_id: z.string().max(64).optional().describe("Do not include this field. The server fills it in."),
  },
  handler: async (input, ctx) => {
    const { error } = await ctx.db.from("conversation_events").insert({
      conversation_id: resolveConversationId(ctx, input.conversation_id),
      event_type: input.event_type,
      summary: input.summary,
      metadata: input.metadata ?? {},
    });
    if (error) throw new Error(error.message);
    return { status: "success", result: { logged: true } };
  },
});
