import { writtenReferences, type Channel, type FinalStatus, type SupabaseClient } from "@koya/shared";
import type { TurnResult } from "./agent/run-turn.ts";

export interface ConversationRecord {
  id: string;
  channel: Channel;
  vapi_call_id: string | null;
  agent_session_id: string | null;
  verified_customer_id: string | null;
  final_status: FinalStatus;
  ended_at: string | null;
}

const COLUMNS = "id, channel, vapi_call_id, agent_session_id, verified_customer_id, final_status, ended_at";

/** Conversation and turn persistence. Turn logging lives here (not in MCP) so it never depends on the model. */
export class ConversationStore {
  /** Vapi call id → conversation, so each turn doesn't pay a database round trip to find it. */
  private readonly byCall = new Map<string, ConversationRecord>();

  constructor(private readonly db: SupabaseClient) {}

  forget(callId: string): void {
    this.byCall.delete(callId);
  }

  async create(input: { channel: Channel; callerId?: string | null; metadata?: Record<string, unknown> }): Promise<ConversationRecord> {
    const { data, error } = await this.db
      .from("conversations")
      .insert({ channel: input.channel, caller_id: input.callerId ?? null, metadata: input.metadata ?? {} })
      .select(COLUMNS)
      .single();
    if (error) throw new Error(`create conversation: ${error.message}`);
    return data as ConversationRecord;
  }

  /** Finds or creates the conversation for a Vapi call. Safe under concurrent requests for the same call. */
  async forVapiCall(input: { callId: string; callerId?: string | null; metadata?: Record<string, unknown> }): Promise<ConversationRecord> {
    const cached = this.byCall.get(input.callId);
    if (cached) return cached;
    const existing = await this.byVapiCall(input.callId);
    if (existing) return this.remember(existing);
    const { data, error } = await this.db
      .from("conversations")
      .upsert(
        { channel: "voice", vapi_call_id: input.callId, caller_id: input.callerId ?? null, metadata: input.metadata ?? {} },
        { onConflict: "vapi_call_id", ignoreDuplicates: true },
      )
      .select(COLUMNS);
    if (error) throw new Error(`upsert conversation: ${error.message}`);
    const row = (data as ConversationRecord[] | null)?.[0] ?? (await this.byVapiCall(input.callId));
    if (!row) throw new Error(`conversation for call ${input.callId} not found after upsert`);
    return this.remember(row);
  }

  private remember(row: ConversationRecord): ConversationRecord {
    if (row.vapi_call_id) {
      if (this.byCall.size > 500) this.byCall.delete(this.byCall.keys().next().value!);
      this.byCall.set(row.vapi_call_id, row);
    }
    return row;
  }

  async byVapiCall(callId: string): Promise<ConversationRecord | null> {
    const { data, error } = await this.db.from("conversations").select(COLUMNS).eq("vapi_call_id", callId).maybeSingle();
    if (error) throw new Error(`find conversation: ${error.message}`);
    return (data as ConversationRecord | null) ?? null;
  }

  /**
   * Marks a conversation as coming from a customer who is signed in to the dashboard. Setting
   * verified_customer_id is what lets the MCP lookups return that customer's full details.
   * Returns a one-line briefing for the agent (name and company only; no internal notes).
   */
  async markSignedIn(conversation: ConversationRecord, customerId: string): Promise<string | null> {
    const { data, error } = await this.db.from("customers").select("customer_id, contact_name, company_name").eq("customer_id", customerId).maybeSingle();
    if (error) throw new Error(`signed-in customer: ${error.message}`);
    if (!data) return null;
    const { error: updateError } = await this.db
      .from("conversations")
      .update({ verified_customer_id: customerId, caller_id: customerId, metadata: { signed_in: true } })
      .eq("id", conversation.id);
    if (updateError) throw new Error(`mark signed in: ${updateError.message}`);
    conversation.verified_customer_id = customerId; // keep the cached record in step
    await this.logEvent(conversation.id, "caller_signed_in", `Caller signed in to the dashboard as ${customerId}`, { customer_id: customerId });
    return `The caller is signed in to the RelayPay dashboard as ${data.contact_name} from ${data.company_name} (customer ID ${customerId}). Their identity is already verified: do not ask them to verify. When they ask about their account, call lookup_customer with customer_id ${customerId}. It also lists their recent transactions and payouts, but use that only to help confirm a payment: still ask for the reference first, and never assume which payment they mean. If you escalate, don't ask for their name or email: leave them out of create_escalation and the account's contact details are used.`;
  }

  async setSession(conversationId: string, sessionId: string): Promise<void> {
    const { error } = await this.db.from("conversations").update({ agent_session_id: sessionId }).eq("id", conversationId);
    if (error) throw new Error(`save session: ${error.message}`);
  }

  async recordTurn(conversationId: string, userTranscript: string, turn: TurnResult): Promise<void> {
    const { count, error: countError } = await this.db
      .from("conversation_turns")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId);
    if (countError) throw new Error(`count turns: ${countError.message}`);
    const note = [turn.uncertaintyNote, turn.status !== "ok" ? `turn ${turn.status}${turn.error ? `: ${turn.error}` : ""}` : null]
      .filter(Boolean)
      .join(" | ");
    const { error } = await this.db.from("conversation_turns").insert({
      conversation_id: conversationId,
      turn_index: (count ?? 0) + 1,
      user_transcript: userTranscript,
      assistant_response: writtenReferences(turn.reply), // "T K T, one zero three five" → "TKT-1035"
      answer_type: turn.answerType,
      confidence: turn.confidence,
      uncertainty_note: note || null,
      tools_used: turn.toolsUsed,
      latency_ms: turn.latencyMs,
    });
    if (error) throw new Error(`record turn: ${error.message}`);
  }

  /** Records a notable agent decision in conversation_events (same table as the MCP log tool). */
  async logEvent(conversationId: string, eventType: string, summary: string, metadata: Record<string, unknown> = {}): Promise<void> {
    const { error } = await this.db.from("conversation_events").insert({ conversation_id: conversationId, event_type: eventType, summary, metadata });
    if (error) throw new Error(`log event: ${error.message}`);
  }

  /** Final status reflects what happened: escalation > ticket > normal completion. */
  async deriveFinalStatus(conversationId: string, fallback: FinalStatus): Promise<FinalStatus> {
    const has = async (table: string) => {
      const { count } = await this.db.from(table).select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
      return (count ?? 0) > 0;
    };
    if (await has("escalations")) return "escalated";
    if (await has("support_tickets")) return "ticket_created";
    return fallback;
  }

  async close(
    conversationId: string,
    input: { endedAt?: string; endedReason?: string | null; summary?: string | null; fallbackStatus: FinalStatus; metadata?: Record<string, unknown> },
  ): Promise<FinalStatus> {
    const finalStatus = await this.deriveFinalStatus(conversationId, input.fallbackStatus);
    const patch: Record<string, unknown> = {
      ended_at: input.endedAt ?? new Date().toISOString(),
      final_status: finalStatus,
      ended_reason: input.endedReason ?? null,
    };
    if (input.summary) patch.summary = input.summary;
    if (input.metadata) patch.metadata = input.metadata;
    const { error } = await this.db.from("conversations").update(patch).eq("id", conversationId);
    if (error) throw new Error(`close conversation: ${error.message}`);
    return finalStatus;
  }
}
