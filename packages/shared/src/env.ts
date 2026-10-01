import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

/**
 * Loads `.env` files without overriding variables already set in the process.
 * Order (first wins): the package's own `.env`, then the workspace root `.env`.
 */
export function loadEnvFiles(cwd: string = process.cwd()): void {
  for (const file of [join(cwd, ".env"), join(findWorkspaceRoot(cwd), ".env")]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

function findWorkspaceRoot(start: string): string {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** Parses env against a zod schema and exits with a readable message on failure. */
export function parseEnv<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    // Logger may not be configured yet, so write directly to stderr.
    process.stderr.write(`Invalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }
  return result.data;
}

/** Treats empty strings as unset so `.env.example` placeholders like `FOO=` behave as missing. */
export const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

export const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info");

export const supabaseEnvSchema = z.object({
  // The dashboard also shows the REST endpoint (…/rest/v1/); the client adds that path
  // itself, so keep only the origin.
  SUPABASE_URL: z.url().transform((value) => new URL(value).origin),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

export const embeddingsEnvSchema = z.object({
  EMBEDDINGS_PROVIDER: z.enum(["openai", "voyage"]).default("openai"),
  EMBEDDINGS_API_KEY: optionalString,
  EMBEDDINGS_MODEL: optionalString,
});
