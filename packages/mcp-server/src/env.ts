import { z } from "zod";
import { embeddingsEnvSchema, loadEnvFiles, logLevelSchema, optionalString, parseEnv, supabaseEnvSchema } from "@koya/shared";

loadEnvFiles();

export const env = parseEnv(
  supabaseEnvSchema.extend(embeddingsEnvSchema.shape).extend({
    // Hosting platforms (Render, Railway, Fly) inject PORT; MCP_PORT wins locally.
    MCP_PORT: z.coerce.number().int().positive().optional(),
    PORT: z.coerce.number().int().positive().default(8787),
    MCP_AUTH_TOKEN: optionalString,
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    LOG_LEVEL: logLevelSchema,
  }),
);

export type Env = typeof env;
export const port = env.MCP_PORT ?? env.PORT;
