/**
 * OpenAI chat-completions wire format, as expected by Vapi's "Custom LLM" provider.
 * Only the fields Koya needs are modelled; everything else in the request is ignored.
 */
import { z } from "zod";

const contentSchema = z.union([
  z.string(),
  z.array(z.object({ type: z.string(), text: z.string().optional() }).loose()),
  z.null(),
]);

export const chatRequestSchema = z
  .object({
    model: z.string().optional(),
    stream: z.boolean().optional(),
    messages: z.array(z.object({ role: z.string(), content: contentSchema.optional() }).loose()).min(1),
    call: z
      .object({
        id: z.string(),
        customer: z.object({ number: z.string().optional() }).loose().optional(),
        assistantOverrides: z.object({ metadata: z.object({ identityToken: z.string().optional() }).loose().optional() }).loose().optional(),
      })
      .loose()
      .optional(),
    // With metadataSendMode "variable", Vapi sends assistant metadata (incl. overrides) here.
    metadata: z.object({ identityToken: z.string().optional() }).loose().optional(),
    // Vapi also forwards assistant/customer objects, tools, temperature, etc. — unused.
  })
  .loose();

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** How a customer who signs in partway through a voice call hands Koya their token (a system message). */
export const IDENTITY_MARKER = /\[koya-identity:([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\]/;

/**
 * The signed-in caller token: call metadata (set when the call or chat starts) or, for a voice
 * caller who signed in mid-call, the newest system message carrying IDENTITY_MARKER. Either way it
 * is only a claim until verifyIdentityToken checks its signature.
 */
export function identityTokenOf(body: ChatRequest): string | undefined {
  const fromMetadata = body.metadata?.identityToken ?? body.call?.assistantOverrides?.metadata?.identityToken;
  if (fromMetadata) return fromMetadata;
  for (let i = body.messages.length - 1; i >= 0; i--) {
    const m = body.messages[i]!;
    if (m.role !== "system") continue;
    const hit = IDENTITY_MARKER.exec(messageText(m.content));
    if (hit) return hit[1];
  }
  return undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Website chat session id (metadata.chatSessionId), when this request comes from the chat window. */
export function chatSessionIdOf(body: ChatRequest): string | null {
  const id = (body.metadata as Record<string, unknown> | undefined)?.chatSessionId;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

export function messageText(content: ChatRequest["messages"][number]["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => p.text ?? "").join(" ");
  return "";
}

/**
 * Everything the caller has said since Koya last spoke (usually one utterance, but two or more
 * when they talked over a reply that was cancelled), plus a plain transcript of what came before.
 */
export function splitConversation(messages: ChatRequest["messages"]): { userText: string; transcript: string } {
  let start = messages.length;
  const pending: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    const text = messageText(m.content).trim();
    if (m.role === "assistant" && text) break;
    if (m.role === "user" && text) {
      pending.unshift(text);
      start = i;
    }
  }
  if (!pending.length) return { userText: "", transcript: "" };
  const transcript = messages
    .slice(0, start)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "Caller" : "Koya"}: ${messageText(m.content).trim()}`)
    .filter((line) => !line.endsWith(":"))
    .join("\n");
  return { userText: pending.join(" "), transcript };
}

export function chunk(id: string, model: string, delta: { role?: "assistant"; content?: string }, finishReason: string | null = null) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

export function completion(id: string, model: string, content: string) {
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
