import { randomUUID, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { Logger } from "@koya/shared";
import type { ConversationStore } from "./db.ts";
import type { TurnService } from "./agent/turn-service.ts";
import { verifyIdentityToken } from "./identity.ts";
import { chatRequestSchema, chunk, completion, identityTokenOf, splitConversation } from "./routes/openai.ts";
import { statusFromEndedReason, vapiServerMessageSchema } from "./routes/vapi.ts";

export interface AppDeps {
  store: ConversationStore;
  turns: TurnService;
  log: Logger;
  model: string;
  llmSecret?: string | undefined;
  webhookSecret?: string | undefined;
  identitySecret?: string | undefined;
  /** Reject Vapi calls that don't carry a valid signed-in caller token. */
  requireSignedIn?: boolean;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function bearer(c: Context) {
  const h = c.req.header("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

const NO_INPUT_REPLY = "Sorry, I didn't catch that. Could you say it again?";

export const SIGN_IN_REQUIRED_REPLY =
  "To talk to Koya, please sign in to your RelayPay dashboard first, then start the call from there.";

export function createApp({ store, turns, log, model, llmSecret, webhookSecret, identitySecret, requireSignedIn = false }: AppDeps) {
  const app = new Hono();
  /** Conversations whose rejection has already been logged, so repeated turns don't flood the events table. */
  const rejectedLogged = new Set<string>();

  /** Streams (or returns) a fixed reply without running the agent. */
  const cannedReply = (c: Context, id: string, model: string, text: string, stream: boolean) =>
    stream
      ? streamSSE(c, async (s) => {
          await s.writeSSE({ data: JSON.stringify(chunk(id, model, { role: "assistant", content: text })) });
          await s.writeSSE({ data: JSON.stringify(chunk(id, model, {}, "stop")) });
          await s.writeSSE({ data: "[DONE]" });
        })
      : c.json(completion(id, model, text));

  app.get("/health", (c) => c.json({ ok: true, model }));

  /**
   * Vapi Custom LLM endpoint (OpenAI-compatible). Vapi posts the whole conversation plus a `call`
   * object each time the caller finishes speaking; we reply with SSE chunks as text is generated.
   */
  const chatCompletions = async (c: Context) => {
    if (llmSecret && !safeEqual(bearer(c), llmSecret)) {
      log.warn("rejected /chat/completions: bad or missing bearer token");
      return c.json({ error: { message: "Unauthorized", type: "invalid_request_error" } }, 401);
    }
    const parsed = chatRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: { message: "Invalid chat completion request", type: "invalid_request_error" } }, 400);
    }
    const body = parsed.data;
    const { userText, transcript } = splitConversation(body.messages);
    const id = `chatcmpl-${randomUUID()}`;
    const replyModel = body.model ?? model;

    const conversation = body.call?.id
      ? await store.forVapiCall({ callId: body.call.id, callerId: body.call.customer?.number ?? null })
      : await store.create({ channel: "text", metadata: { source: "chat-completions" } });

    if (!userText) return cannedReply(c, id, replyModel, NO_INPUT_REPLY, body.stream !== false);

    // Signed-in caller: verify the web app's token once per conversation and brief the agent.
    let callerContext: string | undefined;
    if (!conversation.verified_customer_id) {
      const customerId = await verifyIdentityToken(identityTokenOf(body), identitySecret);
      if (customerId) {
        callerContext = (await store.markSignedIn(conversation, customerId).catch((err: unknown) => {
          log.warn({ err, conversationId: conversation.id }, "could not apply signed-in identity");
          return null;
        })) ?? undefined;
        if (callerContext) log.info({ conversationId: conversation.id, customerId }, "signed-in caller verified by token");
      }
    }

    // Voice calls are for signed-in customers only: without a verified identity the agent never runs.
    if (requireSignedIn && body.call?.id && !conversation.verified_customer_id) {
      if (!rejectedLogged.has(conversation.id)) {
        rejectedLogged.add(conversation.id);
        // Record where a token could have been, without the token itself, to diagnose missing identity.
        log.warn(
          {
            conversationId: conversation.id,
            callId: body.call.id,
            hasToken: Boolean(identityTokenOf(body)),
            bodyKeys: Object.keys(body),
            metadataKeys: Object.keys((body.metadata as Record<string, unknown> | undefined) ?? {}),
            overrideMetadataKeys: Object.keys((body.call?.assistantOverrides?.metadata as Record<string, unknown> | undefined) ?? {}),
          },
          "rejected voice call without a signed-in caller",
        );
        await store
          .logEvent(conversation.id, "unauthenticated_call_rejected", "Voice call without a valid signed-in caller token; agent not run")
          .catch((err: unknown) => log.warn({ err }, "could not log rejected call"));
      }
      return cannedReply(c, id, replyModel, SIGN_IN_REQUIRED_REPLY, body.stream !== false);
    }

    const turnInput = {
      conversationId: conversation.id,
      channel: conversation.channel,
      userText,
      resumeSessionId: conversation.agent_session_id,
      historyTranscript: transcript,
      callerContext,
    };

    if (body.stream === false) {
      const turn = await turns.handleTurn({ ...turnInput, signal: c.req.raw.signal });
      return c.json(completion(id, replyModel, turn.reply));
    }

    return streamSSE(c, async (s) => {
      const controller = new AbortController();
      s.onAbort(() => controller.abort()); // caller hung up or Vapi cancelled (barge-in)
      let first = true;
      let writes = Promise.resolve();
      await turns.handleTurn({
        ...turnInput,
        signal: controller.signal,
        onText: (text) => {
          const delta = first ? { role: "assistant" as const, content: text } : { content: text };
          first = false;
          writes = writes.then(() => s.writeSSE({ data: JSON.stringify(chunk(id, replyModel, delta)) }));
        },
      });
      await writes;
      if (s.aborted) return;
      await s.writeSSE({ data: JSON.stringify(chunk(id, replyModel, {}, "stop")) });
      await s.writeSSE({ data: "[DONE]" });
    });
  };
  app.post("/chat/completions", chatCompletions);
  app.post("/v1/chat/completions", chatCompletions);

  /** Vapi server URL: status updates open conversations, end-of-call reports close them. */
  app.post("/vapi/webhook", async (c) => {
    if (webhookSecret) {
      const provided = c.req.header("x-vapi-secret") ?? bearer(c);
      if (!provided || !safeEqual(provided, webhookSecret)) {
        log.warn("rejected /vapi/webhook: bad or missing secret");
        return c.json({ error: "Unauthorized" }, 401);
      }
    }
    const parsed = vapiServerMessageSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid Vapi server message" }, 400);
    const msg = parsed.data.message;
    const callId = msg.call?.id;
    const wlog = log.child({ vapiEvent: msg.type, callId });
    if (!callId) return c.json({ ok: true, ignored: "no call id" });

    try {
      if (msg.type === "status-update") {
        const convo = await store.forVapiCall({ callId, callerId: msg.call?.customer?.number ?? null });
        if (msg.status === "in-progress") {
          // Warm a Claude Code process for the first turn while Vapi speaks the greeting.
          turns.prewarm(convo.id, "voice", convo.agent_session_id);
        } else if (msg.status === "ended") {
          turns.release(convo.id);
          if (!convo.ended_at) {
            await store.close(convo.id, { fallbackStatus: statusFromEndedReason(msg.endedReason), endedReason: msg.endedReason ?? null });
          }
        }
        wlog.info({ status: msg.status, conversationId: convo.id }, "status update");
      } else if (msg.type === "end-of-call-report") {
        const convo = await store.forVapiCall({ callId, callerId: msg.call?.customer?.number ?? null });
        turns.release(convo.id);
        const finalStatus = await store.close(convo.id, {
          endedAt: msg.endedAt,
          endedReason: msg.endedReason ?? null,
          summary: msg.analysis?.summary ?? msg.summary ?? null,
          fallbackStatus: statusFromEndedReason(msg.endedReason),
          metadata: {
            source: "vapi",
            started_at_vapi: msg.startedAt,
            duration_seconds: msg.durationSeconds,
            cost_usd: msg.cost,
            recording_url: msg.artifact?.recordingUrl,
            transcript: msg.artifact?.transcript,
          },
        });
        store.forget(callId);
        wlog.info({ conversationId: convo.id, finalStatus }, "conversation closed");
      }
    } catch (err) {
      wlog.error({ err }, "webhook handling failed");
      return c.json({ ok: false }, 500);
    }
    return c.json({ ok: true });
  });

  return app;
}
