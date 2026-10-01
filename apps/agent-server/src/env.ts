import { z } from "zod";
import { loadEnvFiles, logLevelSchema, optionalString, parseEnv, supabaseEnvSchema } from "@koya/shared";

loadEnvFiles();

export const env = parseEnv(
  supabaseEnvSchema.extend({
    ANTHROPIC_API_KEY: z.string().min(20, "ANTHROPIC_API_KEY is required (console.anthropic.com → API Keys)"),
    // Fast model by default: every reply is spoken, so latency matters more than depth.
    KOYA_MODEL: z.string().min(3).default("claude-haiku-4-5"),
    // Off by default: on real calls "light" thinking spent 3.5–9 s before the first word.
    // "adaptive" is needed for models that cannot disable thinking (e.g. claude-opus-5-5).
    AGENT_THINKING: z.enum(["off", "light", "adaptive"]).default("off"),
    AGENT_MAX_TURNS: z.coerce.number().int().min(1).max(20).default(8),
    AGENT_TURN_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(25_000),
    PORT: z.coerce.number().int().positive().default(8080),
    MCP_SERVER_URL: z.url().default("http://localhost:8787/mcp"),
    MCP_AUTH_TOKEN: optionalString,
    VAPI_LLM_SECRET: optionalString,
    // Shared with the web app: verifies signed-in caller tokens (empty = voice verification only).
    KOYA_IDENTITY_SECRET: optionalString,
    // Voice calls must come from a customer signed in to the dashboard (valid identity token).
    // "false" allows anonymous callers, who then verify by voice.
    REQUIRE_SIGNED_IN_CALLER: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
    VAPI_WEBHOOK_SECRET: optionalString,
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    LOG_LEVEL: logLevelSchema,
  }),
);

export type Env = typeof env;
