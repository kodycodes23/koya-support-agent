import { defineConfig } from "tsup";

// Bundles @koya/shared into dist/ so the server deploys as a standalone Node app.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: ["@koya/shared"],
});
