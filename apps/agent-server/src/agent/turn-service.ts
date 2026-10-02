import { typedValues, type Channel, type Logger } from "@koya/shared";
import type { ConversationStore } from "../db.ts";
import { OUT_OF_SCOPE_NOTE } from "./answer-type.ts";
import { WarmPool, runAgentTurn, type AgentConfig, type TurnResult } from "./run-turn.ts";

interface InFlight {
  controller: AbortController;
  generation: number;
}

/**
 * Runs caller turns for each conversation and keeps latency low:
 * - a warm Claude Code process is prepared for the next turn while the caller listens;
 * - if the caller interrupts a turn that is still running, it is cancelled without waiting
 *   for it to shut down, and the new turn continues from a fork of the session.
 */
export class TurnService {
  private readonly inFlight = new Map<string, InFlight>();
  /** Latest session id per conversation, so back-to-back turns never wait on a DB read. */
  private readonly sessions = new Map<string, string>();
  private readonly generations = new Map<string, number>();
  private readonly pool: WarmPool;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly store: ConversationStore,
    private readonly log: Logger,
  ) {
    this.pool = new WarmPool(cfg);
  }

  /** Call start: warm a process for the first turn while Vapi speaks the greeting. */
  prewarm(conversationId: string, channel: Channel, resumeSessionId: string | null = null): void {
    if (this.inFlight.has(conversationId)) return;
    this.pool.prepare(conversationId, channel, this.sessions.get(conversationId) ?? resumeSessionId);
  }

  /** Call ended: free the warm process and in-memory state. */
  release(conversationId: string): void {
    this.pool.release(conversationId);
    this.inFlight.get(conversationId)?.controller.abort();
    this.inFlight.delete(conversationId);
    this.sessions.delete(conversationId);
    this.generations.delete(conversationId);
  }

  async handleTurn(input: {
    conversationId: string;
    channel: Channel;
    userText: string;
    resumeSessionId: string | null;
    historyTranscript?: string;
    /** One-off briefing from RelayPay's systems (e.g. the signed-in caller), added to this turn's prompt. */
    callerContext?: string;
    signal?: AbortSignal;
    onText?: (text: string) => void;
  }): Promise<TurnResult> {
    const { conversationId } = input;
    // Values the caller typed on screen are recorded first, so tools can use their exact spelling.
    for (const typed of typedValues(input.userText)) {
      await this.store
        .logEvent(conversationId, "typed_input", `Caller typed their ${typed.field}`, typed)
        .catch((err: unknown) => this.log.warn({ err, conversationId }, "could not record typed input"));
    }
    const previous = this.inFlight.get(conversationId);
    if (previous) {
      this.log.info({ conversationId }, "caller interrupted; cancelling the in-flight turn");
      previous.controller.abort();
    }

    const generation = (this.generations.get(conversationId) ?? 0) + 1;
    this.generations.set(conversationId, generation);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    this.inFlight.set(conversationId, { controller, generation });

    // The in-memory id is newest; the DB value is the fallback (e.g. after a restart).
    const resume = this.sessions.get(conversationId) ?? input.resumeSessionId;
    try {
      const turn = await runAgentTurn(
        this.cfg,
        { ...input, resumeSessionId: resume, fork: Boolean(previous && resume), signal: controller.signal },
        this.pool,
      );
      await this.persist(input, turn, resume, generation);
      return turn;
    } finally {
      input.signal?.removeEventListener("abort", onAbort);
      if (this.inFlight.get(conversationId)?.generation === generation) this.inFlight.delete(conversationId);
    }
  }

  private async persist(
    input: { conversationId: string; channel: Channel; userText: string },
    turn: TurnResult,
    resumed: string | null,
    generation: number,
  ) {
    const { conversationId } = input;
    const latest = this.generations.get(conversationId) === generation;
    try {
      // Only the newest turn may move the session forward; a cancelled older turn must not.
      if (latest && turn.sessionId && turn.sessionId !== resumed) {
        this.sessions.set(conversationId, turn.sessionId);
        await this.store.setSession(conversationId, turn.sessionId);
      }
      if (latest && turn.status !== "aborted") {
        this.pool.prepare(conversationId, input.channel, this.sessions.get(conversationId) ?? turn.sessionId ?? resumed);
      }
      // An aborted turn with nothing spoken is noise; anything the caller heard is recorded.
      if (turn.status !== "aborted" || turn.reply) await this.store.recordTurn(conversationId, input.userText, turn);
      // Notable decisions go to conversation_events deterministically (escalations log themselves via their tool).
      if (latest && turn.answerType === "declined") {
        const kind = turn.uncertaintyNote?.startsWith(OUT_OF_SCOPE_NOTE) ? "declined_out_of_scope" : "declined_unsupported";
        await this.store.logEvent(conversationId, kind, turn.uncertaintyNote ?? "Declined to answer", { reply: turn.reply.slice(0, 300) });
      }
    } catch (err) {
      this.log.error({ err, conversationId }, "failed to persist turn");
    }
  }
}
