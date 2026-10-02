import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { summarize, type ToolCallStatus } from "@koya/shared";
import { z } from "zod";
import { inBackground } from "./background.ts";
import type { ToolContext } from "./context.ts";
import { GUEST_NEXT_STEP, isGuest } from "./tools/shared.ts";

export interface ToolOutcome {
  status: ToolCallStatus;
  result: Record<string, unknown>;
  /** Optional log-safe summary; defaults to a masked, truncated JSON of the result. */
  summary?: string;
}

export interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  /** Why the tool exists — stored on every tool_call_logs row. */
  purpose: string;
  inputSchema: Shape;
  /** Account tools: refused for guests (public-site callers who aren't signed in), whatever the model tries. */
  memberOnly?: boolean;
  handler: (input: z.infer<z.ZodObject<Shape>>, ctx: ToolContext) => Promise<ToolOutcome>;
}

export function defineTool<Shape extends z.ZodRawShape>(def: ToolDefinition<Shape>): ToolDefinition<Shape> {
  return def;
}

/**
 * Registers a tool wrapped in logging and error handling:
 * - input already validated by the MCP SDK against `inputSchema`
 * - every call writes a tool_call_logs row (input/result summaries are masked)
 * - handler errors become a structured `{ ok: false, error }` result, never a thrown exception
 */
export function registerTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  def: ToolDefinition<Shape>,
  ctx: ToolContext,
): void {
  server.registerTool(
    def.name,
    { title: def.title, description: def.description, inputSchema: def.inputSchema },
    // The SDK's generic callback type does not narrow well across our generic; the
    // runtime contract (validated args in, CallToolResult out) is what matters.
    (async (args: z.infer<z.ZodObject<Shape>>) => {
      const outcome = await runTool(def, args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(outcome.result) }],
        structuredContent: outcome.result,
        isError: outcome.status === "error",
      };
    }) as never,
  );
}

export async function runTool<Shape extends z.ZodRawShape>(
  def: ToolDefinition<Shape>,
  args: z.infer<z.ZodObject<Shape>>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const started = performance.now();
  const log = ctx.log.child({ tool: def.name, conversationId: ctx.conversationId });
  let outcome: ToolOutcome;
  let errorMessage: string | null = null;
  try {
    outcome =
      def.memberOnly && (await isGuest(ctx))
        ? { status: "denied", result: { ok: false, guest: true, next_step: GUEST_NEXT_STEP }, summary: "refused: guest caller (not signed in)" }
        : await def.handler(args, ctx);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    log.error({ err }, "tool failed");
    outcome = {
      status: "error",
      result: { ok: false, error: "internal_error", message: "The support system could not complete this request right now." },
    };
  }
  const durationMs = Math.round(performance.now() - started);
  log.info({ status: outcome.status, durationMs }, "tool call");

  // Audit row is written in the background so logging never adds latency to a spoken reply.
  inBackground(
    log,
    "tool_call_logs",
    ctx.db.from("tool_call_logs").insert({
      conversation_id: ctx.conversationId,
      tool_name: def.name,
      purpose: def.purpose,
      input_summary: summarize(args),
      result_summary: outcome.summary ?? summarize(outcome.result),
      status: outcome.status,
      error_message: errorMessage,
      duration_ms: durationMs,
    }),
  );
  return outcome;
}
