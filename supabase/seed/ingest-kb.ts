/**
 * Chunks assets/relaypay-knowledge-base.md into public.kb_chunks.
 * If EMBEDDINGS_API_KEY is set, also stores 1024-dim embeddings for vector search;
 * otherwise search falls back to Postgres full-text search.
 * Idempotent: upserts on chunk_key and deletes chunks that no longer exist.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger, createServiceClient, embed, embeddingsConfigFromEnv } from "@koya/shared";
import { chunkKnowledgeBase } from "./chunk-kb.ts";
import { env } from "./env.ts";

const log = createLogger("kb-ingest", env.LOG_LEVEL);
const db = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const markdown = await readFile(join(env.ASSETS_DIR, "relaypay-knowledge-base.md"), "utf8");
  const chunks = chunkKnowledgeBase(markdown);
  log.info({ chunks: chunks.length }, "chunked knowledge base");

  const embeddings = embeddingsConfigFromEnv(env);
  let vectors: (string | null)[] = chunks.map(() => null);
  if (embeddings) {
    const raw = await embed(embeddings, chunks.map((c) => `${c.section}\n${c.content}`), "document");
    vectors = raw.map((v) => JSON.stringify(v)); // pgvector accepts the '[1,2,3]' text form
    log.info({ provider: embeddings.provider }, "embedded chunks");
  } else {
    log.warn("EMBEDDINGS_API_KEY not set — storing chunks without embeddings (full-text search only)");
  }

  const rows = chunks.map((c, i) => ({ ...c, embedding: vectors[i], updated_at: new Date().toISOString() }));
  const { error } = await db.from("kb_chunks").upsert(rows, { onConflict: "chunk_key" });
  if (error) throw new Error(`kb_chunks upsert: ${error.message}`);

  const keys = chunks.map((c) => c.chunk_key);
  const { error: pruneError } = await db
    .from("kb_chunks")
    .delete()
    .not("chunk_key", "in", `(${keys.map((k) => `"${k}"`).join(",")})`);
  if (pruneError) throw new Error(`kb_chunks prune: ${pruneError.message}`);

  const { data: probe, error: probeError } = await db.rpc("search_kb_chunks_fts", {
    query_text: "What fees does RelayPay charge for international payments?",
    match_count: 2,
  });
  if (probeError) throw new Error(`fts probe: ${probeError.message}`);
  log.info({ top: (probe as { section: string }[]).map((p) => p.section) }, "fts probe: fees question");
  log.info("ingest complete");
}

main().catch((err: unknown) => {
  log.error({ err }, "ingest failed");
  process.exit(1);
});
