# syntax=docker/dockerfile:1
# SSA AI assistant service (OpenAI-compatible chat with Teable data tools).
#
# Build context is the `ssa/` workspace root:
#   docker build -f services/ai/Dockerfile -t ssa/ai .
# (docker compose in ssa/deploy/ does this automatically; works on amd64 + arm64)
ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.13.0 --activate
WORKDIR /app

# ---------- build: compile TypeScript ----------
FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/ai/package.json services/ai/
RUN pnpm install --filter @ssa/ai --frozen-lockfile --prefer-offline
COPY tsconfig.base.json ./
COPY services/ai ./services/ai
RUN pnpm --filter @ssa/ai build

# ---------- runtime: prod dependencies + dist only ----------
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/ai/package.json services/ai/
RUN pnpm install --prod --filter @ssa/ai --frozen-lockfile --prefer-offline --ignore-scripts
COPY --from=build /app/services/ai/dist ./services/ai/dist
WORKDIR /app/services/ai
USER node
EXPOSE 4700
CMD ["node", "dist/index.js"]
