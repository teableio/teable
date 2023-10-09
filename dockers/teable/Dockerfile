#
# EXAMPLE OF MULTISTAGE BUILD FOR MONOREPOS
#
# @link https://github.com/teable-group/teable
#

###################################################################
# Stage 1: Install all workspaces (dev)dependencies               #
#          and generates node_modules folder(s)                   #
# ----------------------------------------------------------------#
# Notes:                                                          #
#   1. this stage relies on buildkit features                     #
#   2. depend on .dockerignore, you must at least                 #
#      ignore: all **/node_modules folders and .yarn/cache        #
###################################################################

ARG NODE_VERSION=18
ARG ALPINE_VERSION=3.18

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS deps
RUN apk add --no-cache rsync

WORKDIR /workspace-install

COPY --link yarn.lock .yarnrc.yml ./
COPY --link .yarn/ ./.yarn/

RUN --mount=type=bind,target=/docker-context \
    rsync -amv --delete \
          --exclude='node_modules' \
          --exclude='*/node_modules' \
          --include='package.json' \
          --include='schema.prisma' \
          --include='.meshrc.yaml' \
          --include='scripts/*' \
          --include='*/' --exclude='*' \
          /docker-context/ /workspace-install/;

# @see https://www.prisma.io/docs/reference/api-reference/environment-variables-reference#cli-binary-targets
# ENV PRISMA_CLI_BINARY_TARGETS=linux-musl

#
# To speed up installations, we override the default yarn cache folder
# and mount it as a buildkit cache mount (builkit will rotate it if needed)
# This strategy allows to exclude the yarn cache in subsequent docker
# layers (size benefit) and reduce packages fetches.
#
# PS:
#  1. Cache mounts can be used in CI (github actions)
#  2. To manually clear the cache
#     > docker builder prune --filter type=exec.cachemount
#
# Does not play well with buildkit on CI
# https://github.com/moby/buildkit/issues/1673

RUN --mount=type=cache,target=/root/.yarn3-cache,id=yarn3-cache \
    YARN_CACHE_FOLDER=/root/.yarn3-cache \
    yarn install --immutable --inline-builds


###################################################################
# Stage 2: Build the app                                          #
###################################################################

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS builder
ENV NODE_ENV=production
ENV NEXTJS_IGNORE_ESLINT=1
ENV NEXTJS_IGNORE_TYPECHECK=0

WORKDIR /app

COPY . .
COPY --from=deps /workspace-install ./

RUN apk add --no-cache make bash

# Optional: if the app depends on global /static shared assets like images, locales...
RUN yarn workspace @teable-group/app share-static-hardlink; \
    yarn g:build

###################################################################
# Stage 3: Extract a minimal image from the build                 #
###################################################################

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runner

WORKDIR /app

ENV NODE_ENV production

# RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/nextjs-app/next.config.js \
                    /app/apps/nextjs-app/next-i18next.config.js \
                    /app/apps/nextjs-app/package.json \
                    /app/apps/nextjs-app/.env \
                    ./apps/nextjs-app/
COPY --from=builder /app/apps/nextjs-app/public ./apps/nextjs-app/public
COPY --from=builder /app/apps/nestjs-backend/package.json ./apps/nestjs-backend/
COPY --from=builder /app/apps/nextjs-app/.next ./apps/nextjs-app/.next
COPY --from=builder /app/apps/nestjs-backend/package.json ./apps/nestjs-backend/
COPY --from=builder /app/apps/nestjs-backend/dist ./apps/nestjs-backend/dist
COPY --from=builder /app/packages/core/ ./packages/core/
COPY --from=builder /app/packages/db-main-prisma/ ./packages/db-main-prisma/
COPY --from=builder /app/packages/common-i18n/ ./packages/common-i18n/
COPY --from=builder /app/packages/openapi/ ./packages/openapi/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# USER nextjs

ENV PORT=3000
EXPOSE ${PORT:-3000}

ENV NEXT_TELEMETRY_DISABLED 1

WORKDIR /app/apps/nestjs-backend

CMD ["node", "./dist"]


###################################################################
# Optional: develop locally                                       #
###################################################################

# FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS develop
# ENV NODE_ENV=development

# WORKDIR /app

# COPY --from=deps /workspace-install ./

# EXPOSE ${PORT:-3000}

# WORKDIR /app/apps/nextjs-app

# CMD ["yarn", "dev", "-p", "${PORT:-3000}"]
