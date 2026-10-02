# Koya agent server (Vapi custom LLM + webhook). Build from the repo root:
#   docker build -f apps/agent-server/Dockerfile -t koya-agent .
# Runs the TypeScript source with tsx, like `pnpm agent:dev`. The Claude Agent SDK's native binary
# for this platform comes from pnpm's optional dependencies, so install inside the image.
FROM node:24-slim
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/agent-server/package.json apps/agent-server/
RUN pnpm install --frozen-lockfile --prod --filter @koya/agent-server...
COPY packages/shared packages/shared
COPY apps/agent-server apps/agent-server
ENV NODE_ENV=production
EXPOSE 8080
# Runs as the unprivileged node user; Claude Code keeps its per-turn session files under its HOME.
USER node
WORKDIR /repo/apps/agent-server
CMD ["node_modules/.bin/tsx", "src/index.ts"]
