# Standalone deploy of the Koya MCP server. Build from the repo root:
#   docker build -f packages/mcp-server/Dockerfile -t koya-mcp .
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/mcp-server packages/mcp-server
RUN pnpm install --frozen-lockfile --filter @koya/mcp-server... && pnpm --filter @koya/mcp-server build \
 && pnpm --filter @koya/mcp-server deploy --prod --legacy /out

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/packages/mcp-server/dist ./dist
EXPOSE 8787
USER node
CMD ["node", "dist/index.js"]
