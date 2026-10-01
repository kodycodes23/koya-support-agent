import type { Logger } from "@koya/shared";
import type { AgentConfig } from "./agent/run-turn.ts";
import { env } from "./env.ts";

export function agentConfig(log: Logger): AgentConfig {
  return {
    model: env.KOYA_MODEL,
    maxTurns: env.AGENT_MAX_TURNS,
    thinking: env.AGENT_THINKING,
    turnTimeoutMs: env.AGENT_TURN_TIMEOUT_MS,
    mcpServerUrl: env.MCP_SERVER_URL,
    mcpAuthToken: env.MCP_AUTH_TOKEN,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    log,
  };
}
