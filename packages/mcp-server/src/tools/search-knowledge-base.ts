import { embed, type KbChunkMatch } from "@koya/shared";
import { z } from "zod";
import { inBackground } from "../background.ts";
import { defineTool } from "../define-tool.ts";
import type { ToolContext } from "../context.ts";

async function vectorSearch(ctx: ToolContext, query: string, topK: number): Promise<KbChunkMatch[] | null> {
  if (!ctx.embeddings) return null;
  try {
    const [vector] = await embed(ctx.embeddings, [query], "query");
    const { data, error } = await ctx.db.rpc("match_kb_chunks", {
      query_embedding: JSON.stringify(vector),
      match_count: topK,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as KbChunkMatch[];
    // Empty means chunks were ingested without embeddings — use FTS instead.
    return rows.length ? rows : null;
  } catch (err) {
    ctx.log.warn({ err }, "vector search failed; falling back to full-text search");
    return null;
  }
}

async function ftsSearch(ctx: ToolContext, query: string, topK: number): Promise<KbChunkMatch[]> {
  const { data, error } = await ctx.db.rpc("search_kb_chunks_fts", { query_text: query, match_count: topK });
  if (error) throw new Error(`full-text search: ${error.message}`);
  return (data ?? []) as KbChunkMatch[];
}

export const searchKnowledgeBase = defineTool({
  name: "search_knowledge_base",
  title: "Search approved RelayPay knowledge",
  description:
    "Search the approved RelayPay support knowledge base. Call this before answering ANY product, pricing, fee, " +
    "timeline, compliance or policy question, and answer only from the returned chunks. " +
    "If no chunk covers the question, say you cannot confidently answer.",
  purpose: "Ground product and policy answers in approved knowledge",
  inputSchema: {
    query: z.string().min(2).max(500).describe("The customer's question, rephrased as a clear search query"),
    top_k: z.number().int().min(1).max(8).optional().describe("How many chunks to return (default 4)"),
  },
  handler: async ({ query, top_k }, ctx) => {
    const topK = top_k ?? 4;
    const vector = await vectorSearch(ctx, query, topK);
    const mode = vector ? "vector" : "fts";
    const chunks = vector ?? (await ftsSearch(ctx, query, topK));
    const top = chunks[0];

    inBackground(ctx.log, "retrieval_logs", ctx.db.from("retrieval_logs").insert({
      conversation_id: ctx.conversationId,
      query,
      retrieval_mode: mode,
      chunk_ids: chunks.map((c) => c.id),
      chunks: chunks.map((c) => ({ id: c.id, source_title: c.source_title, section: c.section, score: c.score })),
      source_title: top ? [...new Set(chunks.map((c) => c.source_title))].join(" | ") : null,
      source_summary: top ? chunks.map((c) => `${c.section}: ${c.summary}`).join(" | ") : null,
    }));

    return {
      status: chunks.length ? "success" : "not_found",
      summary: chunks.length
        ? `${mode}: ${chunks.map((c) => `${c.section} (${c.score.toFixed(2)})`).join("; ")}`
        : `${mode}: no matching chunks`,
      result: {
        found: chunks.length > 0,
        retrieval_mode: mode,
        guidance: chunks.length
          ? "Answer only from these chunks. If they do not directly answer the question, say you cannot confidently answer and offer a ticket or callback."
          : "No approved knowledge covers this. Say you cannot confidently answer and offer a ticket or a callback from a specialist.",
        chunks: chunks.map((c) => ({
          source_title: c.source_title,
          section: c.section,
          content: c.content,
          score: Number(c.score.toFixed(3)),
        })),
      },
    };
  },
});
