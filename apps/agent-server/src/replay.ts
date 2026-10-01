import { createHash } from "node:crypto";
import { messageText, type ChatRequest } from "./routes/openai.ts";

/**
 * Vapi can send the same /chat/completions request twice (for example after a network blip). A
 * resent request has exactly the same messages; a real new turn never does, because the
 * conversation has grown (even "yes" twice has Koya's reply in between).
 *
 * - Resent after the first finished: the stored reply is sent again, without running the agent
 *   (so no tool runs twice and the turn isn't recorded twice).
 * - Resent while the first is still running: it supersedes it like a barge-in, which continues
 *   from a fork of the session as it was before the turn, so the message is never seen twice.
 */
export class ReplayCache {
  private readonly replies = new Map<string, { reply: string; at: number }>();
  /** Requests in progress per key (a resent request can overlap the original). */
  private readonly running = new Map<string, number>();

  constructor(
    private readonly windowMs = 30_000,
    private readonly now = () => Date.now(),
  ) {}

  static keyFor(conversationId: string, messages: ChatRequest["messages"]): string {
    const hash = createHash("sha256");
    for (const m of messages) hash.update(`${m.role}\u0000${messageText(m.content)}\u0001`);
    return `${conversationId}:${hash.digest("hex")}`;
  }

  /** The reply already sent for this exact request, if it finished within the window. */
  replyFor(key: string): string | null {
    const hit = this.replies.get(key);
    return hit && this.now() - hit.at < this.windowMs ? hit.reply : null;
  }

  isRunning(key: string): boolean {
    return (this.running.get(key) ?? 0) > 0;
  }

  start(key: string): void {
    this.running.set(key, (this.running.get(key) ?? 0) + 1);
  }

  finish(key: string, reply: string | null): void {
    const left = (this.running.get(key) ?? 1) - 1;
    if (left > 0) this.running.set(key, left);
    else this.running.delete(key);
    const now = this.now();
    for (const [k, v] of this.replies) if (now - v.at >= this.windowMs) this.replies.delete(k);
    if (reply) this.replies.set(key, { reply, at: now });
  }
}
