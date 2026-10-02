import { z } from "zod";
import { defineTool } from "../define-tool.ts";
import { isGuest } from "./shared.ts";

/**
 * Guest says they already have an account: the website shows a sign-in window. The browser
 * notices this event (voice: by polling, chat: in the reply), and once the customer signs in the
 * same conversation continues as theirs, starting with the question saved here.
 */
export const requestSignIn = defineTool({
  name: "request_sign_in",
  title: "Ask a guest to sign in",
  description:
    "Use when a guest on the public website (not signed in) needs help with their own account, transactions or payouts and " +
    "confirms they already have a RelayPay account. It opens a sign-in window on their screen. Then tell them to sign in there, " +
    "and that you'll pick up right where you left off. Never ask for their password yourself.",
  purpose: "Let an existing customer sign in mid-conversation so account help can continue",
  inputSchema: {
    pending_question: z.string().min(3).max(500).describe("What the caller wants help with, to answer once they've signed in"),
  },
  handler: async (input, ctx) => {
    if (!(await isGuest(ctx))) {
      return { status: "success", result: { already_signed_in: true, next_step: "The caller is already signed in; help them directly." } };
    }
    const { error } = await ctx.db.from("conversation_events").insert({
      conversation_id: ctx.conversationId,
      event_type: "sign_in_requested",
      summary: `Guest asked to sign in to continue: ${input.pending_question}`.slice(0, 500),
      metadata: { pending_question: input.pending_question },
    });
    if (error) throw new Error(error.message);
    return {
      status: "success",
      result: {
        sign_in_window_opened: true,
        next_step:
          "In one short sentence, ask them to sign in using the window on their screen, and say you'll continue right where you left off. Ask nothing else and don't ask for their password.",
      },
    };
  },
});
