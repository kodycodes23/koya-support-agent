import { createEscalation } from "./create-escalation.ts";
import { createSupportTicket } from "./create-support-ticket.ts";
import { logConversationEvent } from "./log-conversation-event.ts";
import { lookupCustomer } from "./lookup-customer.ts";
import { lookupPayout } from "./lookup-payout.ts";
import { lookupTransaction } from "./lookup-transaction.ts";
import { requestSignIn } from "./request-sign-in.ts";
import { searchKnowledgeBase } from "./search-knowledge-base.ts";

export const tools = [
  searchKnowledgeBase,
  lookupCustomer,
  lookupTransaction,
  lookupPayout,
  createSupportTicket,
  createEscalation,
  requestSignIn,
  logConversationEvent,
] as const;
