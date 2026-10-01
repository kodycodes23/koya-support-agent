import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "./define-tool.ts";
import type { ToolContext } from "./context.ts";
import { tools } from "./tools/index.ts";

export const SERVER_INFO = { name: "koya-relaypay-support", version: "0.1.0" };

/** Builds an MCP server with every RelayPay support tool bound to this request's context. */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "RelayPay support tools. Search the knowledge base before policy answers, verify identity before account details, " +
      "never guess statuses, and escalate compliance, dispute, refund, cancellation, restriction and frustrated-customer cases.",
  });
  for (const tool of tools) registerTool(server, tool as never, ctx);
  return server;
}
