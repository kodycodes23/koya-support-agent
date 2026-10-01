import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Local dev: reuse the workspace root .env for server-only values (e.g. the Supabase
// service key used by /api/callback). Only NEXT_PUBLIC_* variables ever reach the browser.
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  // Workspace package shipped as TypeScript source (used for support-team emails).
  transpilePackages: ["@koya/shared"],
};

export default nextConfig;
