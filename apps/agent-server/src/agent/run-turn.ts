import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, startup, type Options, type SDKMessage, type WarmQuery } from "@anthropic-ai/claude-agent-sdk";
import { CONVERSATION_HEADER, SpokenStream, type AnswerType, type Channel, type Confidence, type Logger } from "@koya/shared";
import { classifyTurn, type ToolOutcome } from "./answer-type.ts";
import { MetaTagStripper } from "./meta.ts";
import { buildSystemPrompt } from "./prompt.ts";

/** The only tools the agent may use: our MCP server's. Built-in Claude Code tools are disabled. */
export const MCP_SERVER_NAME = "koya";
export const KOYA_TOOLS = [
  "search_knowledge_base",
  "lookup_customer",
  "lookup_transaction",
  "lookup_payout",
  "create_support_ticket",
  "create_escalation",
  "request_sign_in",
  "log_conversation_event",
] as const;
/** The subset the voice agent may call. log_conversation_event stays available to other MCP clients. */
export const AGENT_TOOLS = KOYA_TOOLS.filter((t) => t !== "log_conversation_event");
const MCP_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

export interface AgentConfig {
  model: string;
  /** "off": no extended thinking (fastest); "light": capped at 1,024 tokens; "adaptive": model decides. */
  thinking: "off" | "light" | "adaptive";
  maxTurns: number;
  turnTimeoutMs: number;
  mcpServerUrl: string;
  mcpAuthToken?: string | undefined;
  anthropicApiKey: string;
  log: Logger;
}

export interface TurnInput {
  conversationId: string;
  channel: Channel;
  userText: string;
  /** Agent SDK session to resume (keeps earlier tool results, e.g. identity verification, in context). */
  resumeSessionId?: string | null;
  /** Prior conversation as plain text, used only when there is no session to resume. */
  historyTranscript?: string;
  /** Resume into a new branch of the session (used when the caller interrupted a turn still in flight). */
  fork?: boolean;
  /** Server-generated briefing (never caller text), prefixed to this turn's prompt as a system line. */
  callerContext?: string;
  signal?: AbortSignal;
  /** Called with speakable text as soon as it is generated. */
  onText?: (text: string) => void;
}

export interface TurnResult {
  reply: string;
  answerType: AnswerType;
  confidence: Confidence | null;
  uncertaintyNote: string | null;
  toolsUsed: string[];
  sessionId: string | null;
  latencyMs: number;
  firstTextMs: number | null;
  costUsd: number | null;
  status: "ok" | "timeout" | "aborted" | "error";
  error?: string;
}

const FALLBACK_REPLY =
  "I'm sorry, I'm having trouble reaching our support systems right now. Would you like me to arrange a callback from a specialist?";

// Sessions are stored under the CLI's config dir keyed by cwd; use an empty dedicated
// directory so nothing project-specific (CLAUDE.md, .mcp.json) can ever be picked up.
const WORKDIR = join(tmpdir(), "koya-agent-workdir");
mkdirSync(WORKDIR, { recursive: true });

/** Minimal environment for the Claude Code subprocess: no database or Vapi secrets. */
function subprocessEnv(apiKey: string): Record<string, string> {
  const keep = ["PATH", "HOME", "USER", "LANG", "TMPDIR", "SHELL", "TERM", "NODE_OPTIONS"];
  const env: Record<string, string> = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k]!;
  return {
    ...env,
    ANTHROPIC_API_KEY: apiKey,
    CLAUDE_AGENT_SDK_CLIENT_APP: "koya-support-agent/0.1.0",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

type SessionTarget = Pick<TurnInput, "conversationId" | "channel" | "resumeSessionId" | "fork">;

export function buildOptions(cfg: AgentConfig, input: SessionTarget, abortController: AbortController, resume: boolean): Options {
  const today = new Date().toISOString().slice(0, 10);
  return {
    model: cfg.model,
    thinking:
      cfg.thinking === "off"
        ? { type: "disabled" }
        : cfg.thinking === "light"
          ? { type: "enabled", budgetTokens: 1024 }
          : { type: "adaptive" },
    systemPrompt: buildSystemPrompt({ today, channel: input.channel }),
    settingSources: [], // load no filesystem settings
    tools: [], // disable every built-in Claude Code tool
    allowedTools: AGENT_TOOLS.map((t) => `${MCP_PREFIX}${t}`), // …and allow only ours
    // The model tended to call the log tool mid-question and then repeat itself; notable
    // decisions are logged deterministically by the server instead (TurnService).
    disallowedTools: [`${MCP_PREFIX}log_conversation_event`],
    permissionMode: "dontAsk", // anything not pre-approved is denied, never prompted
    strictMcpConfig: true,
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: "http",
        url: cfg.mcpServerUrl,
        headers: {
          [CONVERSATION_HEADER]: input.conversationId,
          ...(cfg.mcpAuthToken ? { authorization: `Bearer ${cfg.mcpAuthToken}` } : {}),
        },
      },
    },
    includePartialMessages: true,
    maxTurns: cfg.maxTurns,
    abortController,
    cwd: WORKDIR,
    env: subprocessEnv(cfg.anthropicApiKey),
    ...(resume && input.resumeSessionId
      ? { resume: input.resumeSessionId, ...(input.fork ? { forkSession: true } : {}) }
      : { sessionId: randomUUID() }),
  };
}

/**
 * Caller words can't pose as a RelayPay system line: only buildPrompt adds that tag, so a copy
 * typed or spoken by the caller is defused before it reaches the model.
 */
export const defuseSystemTag = (text: string) => text.replace(/\[\s*relaypay\s+system\s*\]/gi, "(caller wrote: RelayPay system)");

export function buildPrompt(input: TurnInput, resume: boolean): string {
  const system = input.callerContext ? `[RelayPay system] ${input.callerContext}\n\n` : "";
  const userText = defuseSystemTag(input.userText);
  if (resume || !input.historyTranscript?.trim()) return system ? `${system}The caller says: ${userText}` : userText;
  return `${system}Conversation so far:\n${defuseSystemTag(input.historyTranscript.trim())}\n\nThe caller now says: ${userText}`;
}

interface Spare {
  conversationId: string;
  resumeId: string | null;
  controller: AbortController;
  warm: Promise<WarmQuery | null>;
  createdAt: number;
}

/**
 * Pre-started Claude Code processes, one per active conversation. After each turn (and at
 * call start) a spare is started for the *next* turn — already bound to that conversation's
 * session and MCP header — while the caller is listening, so the next reply skips process
 * start-up. Each spare holds a few hundred MB, so the pool is capped and spares expire.
 */
export class WarmPool {
  private readonly spares = new Map<string, Spare>();

  constructor(
    private readonly cfg: AgentConfig,
    private readonly maxSpares = 6,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  prepare(conversationId: string, channel: Channel, resumeId: string | null): void {
    this.release(conversationId);
    while (this.spares.size >= this.maxSpares) {
      const oldest = [...this.spares.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!oldest) break;
      this.release(oldest.conversationId);
    }
    const controller = new AbortController();
    const options = buildOptions(this.cfg, { conversationId, channel, resumeSessionId: resumeId }, controller, Boolean(resumeId));
    const warm = startup({ options }).catch((err: unknown) => {
      this.cfg.log.warn({ err, conversationId }, "prewarm failed; next turn will start cold");
      return null;
    });
    const spare: Spare = { conversationId, resumeId, controller, warm, createdAt: Date.now() };
    this.spares.set(conversationId, spare);
    setTimeout(() => {
      if (this.spares.get(conversationId) === spare) this.release(conversationId);
    }, this.ttlMs).unref();
  }

  /** Hands over the spare if it was prepared for exactly this session state. */
  take(conversationId: string, resumeId: string | null): Spare | null {
    const spare = this.spares.get(conversationId);
    if (!spare || spare.resumeId !== resumeId) return null;
    this.spares.delete(conversationId);
    return spare;
  }

  release(conversationId: string): void {
    const spare = this.spares.get(conversationId);
    if (!spare) return;
    this.spares.delete(conversationId);
    void spare.warm.then((w) => w?.close());
  }
}

/** Runs one caller turn through the Agent SDK, streaming speakable text via onText. */
export async function runAgentTurn(cfg: AgentConfig, input: TurnInput, pool?: WarmPool): Promise<TurnResult> {
  const canResume = Boolean(input.resumeSessionId);
  const first = await attempt(cfg, input, canResume, pool);
  // A missing or corrupt session (e.g. the server restarted on a new machine) fails before any
  // text is produced: retry once as a fresh session seeded with the transcript.
  if (canResume && first.status === "error" && !first.reply) {
    cfg.log.warn({ conversationId: input.conversationId, error: first.error }, "resume failed; retrying as a fresh session");
    return attempt(cfg, input, false);
  }
  return first;
}

async function attempt(cfg: AgentConfig, input: TurnInput, resume: boolean, pool?: WarmPool): Promise<TurnResult> {
  const log = cfg.log.child({ conversationId: input.conversationId });
  const started = performance.now();
  const spare = input.fork ? null : (pool?.take(input.conversationId, resume ? (input.resumeSessionId ?? null) : null) ?? null);
  const abortController = spare?.controller ?? new AbortController();
  const onAbort = () => abortController.abort();
  input.signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, cfg.turnTimeoutMs);

  const stripper = new MetaTagStripper();
  // Voice: references are spelled out in code, so the caller never hears "C U S minus one thousand one".
  const spoken = new SpokenStream({ spellReferences: input.channel === "voice" });
  const toolsUsed: string[] = [];
  let reply = "";
  let firstTextMs: number | null = null;
  let sessionId: string | null = null;
  let costUsd: number | null = null;
  let error: string | undefined;
  let needsSeparator = false;
  let warmStart = false;
  let rawSeen = false;
  /**
   * With thinking off, the model occasionally announces an action but emits a malformed tool
   * call; the Claude Code runtime then injects a "retry the tool call" message and the model
   * starts over, re-saying what the caller already heard. Audio can't be taken back, so the
   * redo's text is muted until its tool call has completed.
   */
  let muteRedo = false;
  let harnessRetries = 0;
  const toolCalls = new Map<string, ToolOutcome>(); // by tool_use id
  /** Stage timeline (ms since the turn started), logged with every turn to keep latency visible. */
  const stages: string[] = [];
  const mark = (label: string) => stages.push(`${label}@${Math.round(performance.now() - started)}`);

  const emit = (raw: string, final = false) => {
    let text = spoken.push(raw) + (final ? spoken.flush() : "");
    if (!text) return;
    if (needsSeparator && reply && !/\s$/.test(reply) && !/^\s/.test(text)) text = ` ${text}`;
    needsSeparator = false;
    if (firstTextMs === null) {
      firstTextMs = Math.round(performance.now() - started);
      mark("first-text");
    }
    reply += text;
    input.onText?.(text);
  };

  try {
    const prompt = buildPrompt(input, resume);
    const warm = spare ? await spare.warm : null;
    warmStart = Boolean(warm);
    mark(warm ? "warm-ready" : "cold-start");
    const stream = warm ? warm.query(prompt) : query({ prompt, options: buildOptions(cfg, input, abortController, resume) });
    for await (const message of stream as AsyncIterable<SDKMessage>) {
      sessionId ??= "session_id" in message ? (message.session_id as string) : null;
      switch (message.type) {
        case "system":
          if (message.subtype === "init") {
            mark("init");
            const failed = message.mcp_servers.filter((s) => s.status !== "connected");
            if (failed.length) log.error({ mcp: failed }, "MCP server not connected");
          }
          break;
        case "stream_event": {
          if (message.parent_tool_use_id) break;
          const ev = message.event;
          if (ev.type === "message_start") {
            // Release everything held from the previous message before a new one starts.
            if (muteRedo) stripper.flush();
            else emit(stripper.flush(), true);
            needsSeparator = true;
            mark("model");
          }
          if (ev.type === "content_block_start") mark(`block:${ev.content_block.type}`);
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            if (!rawSeen) {
              rawSeen = true;
              mark(`raw:${JSON.stringify(ev.delta.text.slice(0, 12))}`);
            }
            const text = stripper.push(ev.delta.text);
            if (!muteRedo) emit(text);
          }
          break;
        }
        case "assistant":
          for (const block of message.message.content) {
            if (block.type === "tool_use" && block.name.startsWith(MCP_PREFIX)) {
              const name = block.name.slice(MCP_PREFIX.length);
              toolsUsed.push(name);
              toolCalls.set(block.id, { name, input: (block.input ?? {}) as Record<string, unknown>, result: null });
              mark(`tool:${name}`);
            }
          }
          // Flush any text held back while checking for a tag at the end of this message.
          if (muteRedo) stripper.flush();
          else emit(stripper.flush(), true);
          break;
        case "user": {
          const content = (message.message as { content?: unknown }).content;
          const blocks = Array.isArray(content) ? (content as { type?: string; text?: string; tool_use_id?: string; content?: unknown }[]) : [];
          if (blocks.some((b) => b.type === "tool_result")) {
            mark("tool-result");
            muteRedo = false;
            for (const b of blocks) {
              const call = b.tool_use_id ? toolCalls.get(b.tool_use_id) : undefined;
              if (call) call.result = parseToolResult(b.content);
            }
          } else if (blocks.some((b) => b.type === "text" && /retry the tool call|valid tool call/i.test(b.text ?? ""))) {
            harnessRetries++;
            muteRedo = true;
            mark("harness-retry");
          }
          break;
        }
        case "result":
          mark("done");
          costUsd = message.total_cost_usd;
          if (message.subtype !== "success") error = `${message.subtype}${"errors" in message ? `: ${message.errors.join("; ")}` : ""}`;
          else if (message.is_error) error = message.result || "agent returned an error";
          if (message.permission_denials?.length) log.warn({ denials: message.permission_denials.map((d) => d.tool_name) }, "tool permission denied");
          break;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
  }
  emit(stripper.flush(), true);

  const aborted = abortController.signal.aborted;
  // A malformed tool call that also failed on retry, after the caller already heard a proper
  // reply, is not a failed turn from the caller's side: keep it visible in the note instead.
  const recovered = Boolean(error && reply && /tool call could not be parsed/i.test(error));
  const status: TurnResult["status"] = timedOut ? "timeout" : aborted ? "aborted" : error && !recovered ? "error" : "ok";
  if (status === "timeout" || (status === "error" && !reply)) {
    // Say something rather than leave the caller in silence.
    if (!reply) emit(FALLBACK_REPLY, true);
  }
  if (status !== "ok") log.warn({ status, error }, "agent turn did not complete cleanly");

  const classification = classifyTurn([...toolCalls.values()], reply);
  const notes = [classification.note];
  if (harnessRetries) notes.push(`${harnessRetries} malformed tool call(s) retried`);
  if (recovered) notes.push("a malformed tool call was dropped after retry");
  const latencyMs = Math.round(performance.now() - started);
  log.info({ latencyMs, firstTextMs, warmStart, harnessRetries, stages: stages.join(" "), toolsUsed, answerType: classification.answerType, costUsd, status }, "agent turn");
  return {
    reply: reply.trim(),
    answerType: classification.answerType,
    confidence: classification.confidence,
    uncertaintyNote: notes.join("; "),
    toolsUsed,
    sessionId: status === "ok" || reply ? sessionId : null,
    latencyMs,
    firstTextMs,
    costUsd,
    status,
    ...(error ? { error } : {}),
  };
}

/** MCP tool results arrive as text blocks holding the tool's JSON. */
function parseToolResult(content: unknown): Record<string, unknown> | null {
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? (content as { type?: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text ?? "").join("")
      : "";
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
