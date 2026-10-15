# syntax=docker/dockerfile:1
# SSA notify service (Gmail digest + record event alerts).
#
# Build context is the `ssa/` workspace root:
#   docker build -f services/notify/Dockerfile -t ssa/notify .
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
COPY services/notify/package.json services/notify/
RUN pnpm install --filter @ssa/notify --frozen-lockfile --prefer-offline
COPY tsconfig.base.json ./
COPY services/notify ./services/notify
RUN pnpm --filter @ssa/notify build

# ---------- runtime: prod dependencies + dist only ----------
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/notify/package.json services/notify/
RUN pnpm install --prod --filter @ssa/notify --frozen-lockfile --prefer-offline --ignore-scripts
COPY --from=build /app/services/notify/dist ./services/notify/dist
WORKDIR /app/services/notify
USER node
EXPOSE 4600
CMD ["node", "dist/index.js"]
