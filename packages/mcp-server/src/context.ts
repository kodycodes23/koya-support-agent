import type { EmbeddingsConfig, Logger, SupabaseClient } from "@koya/shared";

/** Per-request dependencies handed to every tool handler. */
export interface ToolContext {
  db: SupabaseClient;
  log: Logger;
  embeddings: EmbeddingsConfig | null;
  /** From the x-conversation-id header; null when absent or not a UUID. */
  conversationId: string | null;
  /** Injected for tests; defaults to the real clock. */
  now: () => Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseConversationId(value: unknown): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && UUID.test(v) ? v : null;
}

/** Tool input may carry a conversation_id; fall back to the header. Invalid IDs are ignored. */
export function resolveConversationId(ctx: ToolContext, fromInput?: string | null): string | null {
  return parseConversationId(fromInput) ?? ctx.conversationId;
}
