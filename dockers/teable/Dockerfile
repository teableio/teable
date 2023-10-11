#
# EXAMPLE OF MULTISTAGE BUILD FOR MONOREPOS
#
# @link https://github.com/teable-group/teable
#

###################################################################
# Stage 1: Install all workspaces (dev)dependencies               #
#          and generates node_modules folder(s)                   #
###################################################################

ARG NODE_VERSION=18
ARG ALPINE_VERSION=3.18

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS deps
RUN apk add --no-cache make bash rsync && corepack enable

WORKDIR /workspace-install

COPY --link package.json yarn.lock ./

COPY --link . .

# Disabling some well-known postinstall scripts
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
ENV HUSKY=0

RUN npm install skip-postinstall -g
RUN yarn install --immutable --inline-builds

###################################################################
# Stage 2: Build the app                                          #
###################################################################

FROM deps AS builder

ENV NEXT_BUILD_ENV_TYPECHECK=false
ENV NEXT_BUILD_ENV_LINT=false
ENV NEXT_BUILD_ENV_OUTPUT=standalone
ENV NEXT_BUILD_ENV_SENTRY_ENABLED=false
ENV NEXT_BUILD_ENV_SENTRY_TRACING=false


# Optimize for YARN installation speed
ENV YARN_ENABLE_GLOBAL_CACHE=false
ENV YARN_ENABLE_MIRROR=false
ENV YARN_NODE_LINKER=node-modules
ENV YARN_NM_MODE=hardlinks-local
# If using different compression level than in local (recommended: prefer to not do this)
#ENV YARN_COMPRESSION_LEVEL 0
#ENV YARN_CHECKSUM_BEHAVIOR ignore

WORKDIR /app

COPY --from=deps --link /workspace-install ./

# Optional: if the app depends on global /static shared assets like images, locales...
RUN yarn workspace @teable-group/db-main-prisma prisma-generate --schema ./prisma/postgres/schema.prisma
RUN yarn workspace @teable-group/app share-static-hardlink; \
      yarn g:build

# Does not play well with buildkit on CI
# https://github.com/moby/buildkit/issues/1673
RUN SKIP_POSTINSTALL=1 \
    yarn workspaces focus --production @teable-group/core @teable-group/openapi @teable-group/db-main-prisma \
      @teable-group/backend @teable-group/app

##################################################################
# Stage 3: Extract a minimal image from the build                #
##################################################################

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runner

ENV NODE_ENV=production
ENV PORT=${NEXTJS_APP_PORT:-3000}

RUN apk add --no-cache bash && corepack enable

WORKDIR /app

#RUN addgroup --system --gid 1001 nodejs
#RUN adduser --system --uid 1001 nextjs

# Set the correct permission for prerender cache
#RUN mkdir .next
#RUN chown nextjs:nodejs .next

#USER nextjs

COPY --from=builder /app/apps/nextjs-app/next.config.js \
                    /app/apps/nextjs-app/next-i18next.config.js \
                    /app/apps/nextjs-app/package.json \
                    ./

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder /app/apps/nextjs-app/.next/standalone ./
COPY --from=builder /app/apps/nextjs-app/.next/static ./apps/nextjs-app/.next/static
COPY --from=builder /app/apps/nextjs-app/public ./apps/nextjs-app/public

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/nestjs-backend/package.json ./apps/nestjs-backend/
COPY --from=builder /app/apps/nestjs-backend/dist ./apps/nestjs-backend/dist

COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist ./packages/core/dist

COPY --from=builder /app/packages/db-main-prisma/package.json ./packages/db-main-prisma/
COPY --from=builder /app/packages/db-main-prisma/dist ./packages/db-main-prisma/dist

COPY --from=builder /app/packages/openapi/package.json ./packages/openapi/
COPY --from=builder /app/packages/openapi/dist ./packages/openapi/dist

EXPOSE ${PORT}

CMD ["bash", "-c", "cd ./apps/nestjs-backend && node ./dist"]
