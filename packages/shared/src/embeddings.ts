/**
 * Provider-agnostic embeddings. Both providers are pinned to 1024 dimensions so the
 * `kb_chunks.embedding vector(1024)` column works with either.
 * When no API key is configured, callers fall back to Postgres full-text search.
 */
export const EMBEDDING_DIMENSIONS = 1024;

export type EmbeddingsProvider = "openai" | "voyage";
export type EmbeddingPurpose = "document" | "query";

export interface EmbeddingsConfig {
  provider: EmbeddingsProvider;
  apiKey: string;
  model?: string | undefined;
}

const DEFAULT_MODELS: Record<EmbeddingsProvider, string> = {
  openai: "text-embedding-3-small",
  voyage: "voyage-3.5-lite",
};

export function embeddingsConfigFromEnv(env: {
  EMBEDDINGS_PROVIDER: EmbeddingsProvider;
  EMBEDDINGS_API_KEY?: string | undefined;
  EMBEDDINGS_MODEL?: string | undefined;
}): EmbeddingsConfig | null {
  if (!env.EMBEDDINGS_API_KEY) return null;
  return { provider: env.EMBEDDINGS_PROVIDER, apiKey: env.EMBEDDINGS_API_KEY, model: env.EMBEDDINGS_MODEL };
}

export async function embed(
  config: EmbeddingsConfig,
  inputs: string[],
  purpose: EmbeddingPurpose,
): Promise<number[][]> {
  const model = config.model ?? DEFAULT_MODELS[config.provider];
  const request =
    config.provider === "openai"
      ? {
          url: "https://api.openai.com/v1/embeddings",
          body: { model, input: inputs, dimensions: EMBEDDING_DIMENSIONS },
        }
      : {
          url: "https://api.voyageai.com/v1/embeddings",
          body: { model, input: inputs, input_type: purpose, output_dimension: EMBEDDING_DIMENSIONS },
        };

  const res = await fetch(request.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Never include the key; the body is the provider's error message.
    throw new Error(`${config.provider} embeddings failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { data: { embedding: number[]; index?: number }[] };
  return [...json.data]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding);
}
