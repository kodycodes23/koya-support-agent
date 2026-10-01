import { createLogger, createServiceClient, embeddingsConfigFromEnv } from "@koya/shared";
import { createApp } from "./app.ts";
import { flushBackgroundWrites } from "./background.ts";
import { env, port } from "./env.ts";

const log = createLogger("mcp-server", env.LOG_LEVEL);

if (!env.MCP_AUTH_TOKEN) {
  if (env.NODE_ENV === "production") {
    log.fatal("MCP_AUTH_TOKEN is required in production");
    process.exit(1);
  }
  log.warn("MCP_AUTH_TOKEN not set — /mcp is unauthenticated (dev only)");
}

const embeddings = embeddingsConfigFromEnv(env);
const app = createApp({
  db: createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
  log,
  embeddings,
  authToken: env.MCP_AUTH_TOKEN,
});

const server = app.listen(port, () => {
  log.info({ port, retrieval: embeddings ? `vector (${embeddings.provider}) + fts fallback` : "fts" }, "Koya MCP server listening on /mcp");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log.info({ signal }, "shutting down");
    server.close(() => void flushBackgroundWrites().finally(() => process.exit(0)));
  });
}
