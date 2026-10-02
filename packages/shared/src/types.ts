/** Shared enums and row shapes. Values mirror the CHECK constraints in supabase/migrations. */

export const ANSWER_TYPES = ["answered", "clarifying", "escalated", "declined", "lookup"] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const CHANNELS = ["voice", "chat", "text", "eval"] as const;
export type Channel = (typeof CHANNELS)[number];

export const TICKET_CATEGORIES = ["payment", "payout", "invoice", "account", "compliance", "technical", "other"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** From escalation-rules.md. Refunds/cancellations map to `dispute` or `payment`. */
export const ESCALATION_CATEGORIES = ["compliance", "account", "dispute", "payment", "onboarding", "other"] as const;
export type EscalationCategory = (typeof ESCALATION_CATEGORIES)[number];

export const RECORD_STATUSES = ["open", "pending", "in_progress", "closed"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const TOOL_CALL_STATUSES = ["success", "not_found", "error", "denied"] as const;
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

export const FINAL_STATUSES = ["active", "completed", "escalated", "ticket_created", "abandoned", "error"] as const;
export type FinalStatus = (typeof FINAL_STATUSES)[number];

export interface CustomerRow {
  customer_id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  plan: string;
  account_status: string;
  region: string;
  kyc_status: string;
  support_notes: string;
}

export interface TransactionRow {
  transaction_id: string;
  customer_id: string;
  transaction_type: string;
  amount: number;
  currency: string;
  destination_country: string | null;
  status: string;
  created_at: string;
  estimated_arrival: string | null;
  support_summary: string;
}

export interface PayoutRow {
  payout_id: string;
  transaction_id: string | null;
  customer_id: string;
  recipient_name: string;
  amount: number;
  currency: string;
  status: string;
  scheduled_for: string | null;
  failure_reason: string | null;
}

export interface KbChunkMatch {
  id: string;
  source_title: string;
  section: string;
  content: string;
  summary: string;
  score: number;
}

/** HTTP header the agent server uses to tell the MCP server which conversation a tool call belongs to. */
export const CONVERSATION_HEADER = "x-conversation-id";
