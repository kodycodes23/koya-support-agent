import { fileURLToPath } from "node:url";
import { z } from "zod";
import { embeddingsEnvSchema, loadEnvFiles, logLevelSchema, parseEnv, supabaseEnvSchema } from "@koya/shared";

loadEnvFiles();

const defaultAssetsDir = fileURLToPath(new URL("../../assets", import.meta.url));

export const env = parseEnv(
  supabaseEnvSchema.extend(embeddingsEnvSchema.shape).extend({
    ASSETS_DIR: z.string().default(defaultAssetsDir),
    LOG_LEVEL: logLevelSchema,
  }),
);
