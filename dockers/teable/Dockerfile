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
RUN pnpm install --prefer-offline --frozen-lockfile

###################################################################
# Stage 2: Build the app                                          #
###################################################################

FROM deps AS builder

ARG INTEGRATION_TEST

ENV NEXT_BUILD_ENV_TYPECHECK=false
ENV NEXT_BUILD_ENV_LINT=false
ENV NEXT_BUILD_ENV_OUTPUT=classic
ENV NEXT_BUILD_ENV_SENTRY_ENABLED=false
ENV NEXT_BUILD_ENV_SENTRY_TRACING=false

WORKDIR /app

COPY --from=deps --link /workspace-install ./

RUN pnpm -F @teable-group/db-main-prisma prisma-generate --schema ./prisma/postgres/schema.prisma

# Distinguish whether it is an integration test operation
RUN if [ -n "$INTEGRATION_TEST" ];  \
    then pnpm -F "./packages/**" run build;  \
    else pnpm g:build; \
    fi


##################################################################
# Stage 3: Post Builder                                          #
##################################################################

FROM builder as post-builder

WORKDIR /app

RUN rm -fr node_modules && pnpm nuke:node_modules && \
      rm -fr ./packages/eslint-config-bases ./packages/ui-lib && \
      pnpm install --prod --prefer-offline --frozen-lockfile && \
      chmod +x ./scripts/post-build-cleanup.sh && bash ./scripts/post-build-cleanup.sh && \
      pnpm -F @teable-group/db-main-prisma prisma-generate --schema ./prisma/postgres/schema.prisma


##################################################################
# Stage 4: Extract a minimal image from the build                #
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

COPY --from=post-builder /app/apps/nextjs-app/next.config.js \
                    /app/apps/nextjs-app/next-i18next.config.js \
                    /app/apps/nextjs-app/package.json \
                    /app/apps/nextjs-app/.env \
                    ./apps/nextjs-app/

COPY --from=post-builder /app/apps/nextjs-app/.next ./apps/nextjs-app/.next
COPY --from=post-builder /app/apps/nextjs-app/node_modules ./apps/nextjs-app/node_modules
COPY --from=post-builder /app/apps/nextjs-app/public ./apps/nextjs-app/public

COPY --from=post-builder /app/apps/nestjs-backend/dist ./apps/nestjs-backend/dist
COPY --from=post-builder /app/apps/nestjs-backend/node_modules ./apps/nestjs-backend/node_modules
COPY --from=post-builder /app/apps/nestjs-backend/package.json ./apps/nestjs-backend/

COPY --from=builder /app/packages/common-i18n/ ./packages/common-i18n/

COPY --from=post-builder /app/packages ./packages
COPY --from=post-builder /app/node_modules ./node_modules
COPY --from=post-builder /app/package.json ./package.json


EXPOSE ${PORT}

CMD ["bash", "-c", "cd ./apps/nestjs-backend && node ./dist"]
