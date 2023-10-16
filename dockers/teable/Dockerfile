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

# Disabling some well-known postinstall scripts
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
ENV HUSKY=0

RUN apk add --no-cache make bash rsync && corepack enable

WORKDIR /workspace-install

COPY --link package.json pnpm-workspace.yaml pnpm-lock.yaml ./

RUN pnpm fetch

COPY --link . .

RUN npm install is-ci husky -g
RUN pnpm install -r --offline --frozen-lockfile

###################################################################
# Stage 2: Build the app                                          #
###################################################################

FROM deps AS builder

ARG INTEGRATION_TEST

ENV NEXT_BUILD_ENV_TYPECHECK=false
ENV NEXT_BUILD_ENV_LINT=false
ENV NEXT_BUILD_ENV_OUTPUT=standalone
ENV NEXT_BUILD_ENV_SENTRY_ENABLED=false
ENV NEXT_BUILD_ENV_SENTRY_TRACING=false

WORKDIR /app

COPY --from=deps --link /workspace-install ./

RUN pnpm -F @teable-group/db-main-prisma prisma-generate --schema ./prisma/postgres/schema.prisma

# Distinguish whether it is an integration test operation
RUN if [ -n "$INTEGRATION_TEST" ];  \
    then pnpm -F "./packages/**" run build;  \
    else pnpm -F @teable-group/app share-static-hardlink &&  \
            pnpm g:build && \
            pnpm prune --prod; \
    fi


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
COPY --from=builder /app/apps/nestjs-backend/dist ./apps/nestjs-backend/dist
COPY --from=builder /app/apps/nestjs-backend/node_modules ./apps/nestjs-backend/node_modules
COPY --from=builder /app/apps/nestjs-backend/package.json ./apps/nestjs-backend/


COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /app/packages/core/package.json ./packages/core/

COPY --from=builder /app/packages/openapi/dist ./packages/openapi/dist
COPY --from=builder /app/packages/openapi/node_modules ./packages/openapi/node_modules
COPY --from=builder /app/packages/openapi/package.json ./packages/openapi/

COPY --from=builder /app/packages/db-main-prisma/dist ./packages/db-main-prisma/dist
COPY --from=builder /app/packages/db-main-prisma/node_modules ./packages/db-main-prisma/node_modules
COPY --from=builder /app/packages/db-main-prisma/package.json ./packages/db-main-prisma/

COPY --from=builder /app/packages/openapi/dist ./packages/openapi/dist
COPY --from=builder /app/packages/openapi/node_modules ./packages/openapi/node_modules
COPY --from=builder /app/packages/openapi/package.json ./packages/openapi/

EXPOSE ${PORT}

CMD ["bash", "-c", "cd ./apps/nestjs-backend && node ./dist"]
