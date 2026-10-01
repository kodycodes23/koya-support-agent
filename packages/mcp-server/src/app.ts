import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { CONVERSATION_HEADER, type EmbeddingsConfig, type Logger, type SupabaseClient } from "@koya/shared";
import { parseConversationId } from "./context.ts";
import { SERVER_INFO, createMcpServer } from "./server.ts";
import { tools } from "./tools/index.ts";

export interface AppDeps {
  db: SupabaseClient;
  log: Logger;
  embeddings: EmbeddingsConfig | null;
  authToken: string | undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createApp({ db, log, embeddings, authToken }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, server: SERVER_INFO, tools: tools.map((t) => t.name), retrieval: embeddings ? "vector+fts" : "fts" });
  });

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!authToken) return next();
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token && safeEqual(token, authToken)) return next();
    log.warn({ ip: req.ip }, "rejected MCP request: bad or missing bearer token");
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
  };

  // Stateless Streamable HTTP: a fresh server + transport per request, so the
  // conversation header is bound into that request's tool context.
  app.post("/mcp", requireAuth, async (req, res) => {
    const conversationId = parseConversationId(req.header(CONVERSATION_HEADER));
    const server = createMcpServer({ db, log, embeddings, conversationId, now: () => new Date() });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error({ err }, "MCP request failed");
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  // Stateless mode has no sessions to stream to or delete.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}
