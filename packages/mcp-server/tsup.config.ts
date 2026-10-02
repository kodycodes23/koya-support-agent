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
  // Bundled CommonJS dependencies (pino) call require() for Node built-ins, which an ES module
  // bundle doesn't have: give it one.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
