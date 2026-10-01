import { serve } from "@hono/node-server";
import { createLogger, createServiceClient } from "@koya/shared";
import { TurnService } from "./agent/turn-service.ts";
import { createApp } from "./app.ts";
import { ConversationStore } from "./db.ts";
import { agentConfig } from "./config.ts";
import { env } from "./env.ts";

const log = createLogger("agent-server", env.LOG_LEVEL);
for (const [name, value] of [["VAPI_LLM_SECRET", env.VAPI_LLM_SECRET], ["VAPI_WEBHOOK_SECRET", env.VAPI_WEBHOOK_SECRET]] as const) {
  if (!value) {
    if (env.NODE_ENV === "production") {
      log.fatal(`${name} is required in production`);
      process.exit(1);
    }
    log.warn(`${name} not set — endpoint is unauthenticated (dev only)`);
  }
}

const store = new ConversationStore(createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));
const turns = new TurnService(agentConfig(log), store, log);
const app = createApp({
  store,
  turns,
  log,
  model: env.KOYA_MODEL,
  llmSecret: env.VAPI_LLM_SECRET,
  webhookSecret: env.VAPI_WEBHOOK_SECRET,
  identitySecret: env.KOYA_IDENTITY_SECRET,
  requireSignedIn: env.REQUIRE_SIGNED_IN_CALLER,
});
if (env.REQUIRE_SIGNED_IN_CALLER && !env.KOYA_IDENTITY_SECRET) {
  log.error("REQUIRE_SIGNED_IN_CALLER is on but KOYA_IDENTITY_SECRET is not set: every voice call will be rejected");
}

const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  log.info({ port, model: env.KOYA_MODEL, mcp: env.MCP_SERVER_URL }, "Koya agent server listening (POST /chat/completions, POST /vapi/webhook)");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
  });
}
