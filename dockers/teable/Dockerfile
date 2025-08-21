ARG NODE_VERSION=20.9.0
ARG BUILD_VERSION="1.0.0-alpha"

###################################################################
# Stage 1: Install all workspaces (dev)dependencies               #
#          and generates node_modules folder(s)                   #
###################################################################

FROM node:${NODE_VERSION}-bookworm AS deps
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && pnpm add npm-run-all2 zx -g

# Disabling some well-known postinstall scripts
ENV HUSKY=0

WORKDIR /workspace-install

COPY --link package.json pnpm-workspace.yaml pnpm-lock.yaml ./

RUN pnpm fetch

COPY --link . .

RUN pnpm install --prefer-offline --frozen-lockfile
RUN pnpm -F @teable/db-main-prisma prisma-generate --schema ./prisma/postgres/schema.prisma

###################################################################
# Stage 2: Build the app                                          #
###################################################################

FROM deps AS builder

ARG INTEGRATION_TEST
ARG BUILD_VERSION
ARG ENABLE_CSP=true
ARG SENTRY_ENABLED=true
ARG SENTRY_TRACING=true

ENV NODE_ENV=production \
    NEXT_BUILD_ENV_CSP=${ENABLE_CSP} \
    NEXT_BUILD_ENV_TYPECHECK=false \
    NEXT_BUILD_ENV_LINT=false \
    NEXT_BUILD_ENV_SENTRY_ENABLED=${SENTRY_ENABLED} \
    NEXT_BUILD_ENV_SENTRY_TRACING=${SENTRY_TRACING}

WORKDIR /app

COPY --from=deps --link /workspace-install ./

RUN set -ex; \
        echo "\nNEXT_PUBLIC_BUILD_VERSION=\"${BUILD_VERSION}\"" >> apps/nextjs-app/.env; \
# Distinguish whether it is an integration test operation
        if [ -n "$INTEGRATION_TEST" ]; then \
              pnpm -F "./packages/**" run build; \
        else \
              NODE_OPTIONS=--max-old-space-size=8192 pnpm g:build; \
        fi


##################################################################
# Stage 3: Post Builder                                          #
##################################################################

FROM builder as post-builder

ENV NODE_ENV=production

WORKDIR /app

ARG UPLOAD_ASSETS_LIST=""

RUN set -ex; \
        rm -fr node_modules; \
        pnpm nuke:node_modules; \
        chmod +x ./scripts/post-build-cleanup.mjs; \
        zx ./scripts/post-build-cleanup.mjs; \
        pnpm install --prod --prefer-offline --frozen-lockfile; \
        pnpm -F @teable/db-main-prisma prisma-generate --schema ./prisma/postgres/schema.prisma

RUN set -ex; \
        apt-get update; \
        apt-get install -y --no-install-recommends rsync; \
        rm -rf /var/lib/apt/lists/*; \
        chmod +x ./scripts/upload-assets.mjs; \
        zx ./scripts/upload-assets.mjs --list="$UPLOAD_ASSETS_LIST";


##################################################################
# Stage 4: Extract a minimal image from the build                #
##################################################################

FROM node:${NODE_VERSION}-bookworm-slim AS runner

ENV TZ=UTC \
    NODE_ENV=production \
    PORT=${NEXTJS_APP_PORT:-3000}\
    NEXTJS_DIR=apps/nextjs-app \
    PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH"

RUN set -ex; \
        npm install zx -g; \
        corepack enable; \
        apt-get update; \
        apt-get install -y --no-install-recommends \
                curl \
                openssl \
    	; \
    	rm -rf /var/lib/apt/lists/*

# install gosu for a better su+exec command
# https://github.com/tianon/gosu/blob/master/INSTALL.md
ENV GOSU_VERSION 1.17
RUN set -eux; \
# save list of currently installed packages for later so we can clean up
        savedAptMark="$(apt-mark showmanual)"; \
        apt-get update; \
        apt-get install -y --no-install-recommends ca-certificates gnupg wget; \
        rm -rf /var/lib/apt/lists/*; \
        \
        dpkgArch="$(dpkg --print-architecture | awk -F- '{ print $NF }')"; \
        wget -nv -O /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/$GOSU_VERSION/gosu-$dpkgArch"; \
        wget -nv -O /usr/local/bin/gosu.asc "https://github.com/tianon/gosu/releases/download/$GOSU_VERSION/gosu-$dpkgArch.asc"; \
        \
# verify the signature
        export GNUPGHOME="$(mktemp -d)"; \
        gpg --batch --keyserver hkps://keys.openpgp.org --recv-keys B42F6819007F00F88E364FD4036A9C25BF357DD4; \
        gpg --batch --verify /usr/local/bin/gosu.asc /usr/local/bin/gosu; \
        gpgconf --kill all; \
        rm -rf "$GNUPGHOME" /usr/local/bin/gosu.asc; \
        \
# clean up fetch dependencies
        apt-mark auto '.*' > /dev/null; \
        [ -z "$savedAptMark" ] || apt-mark manual $savedAptMark; \
        apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false; \
        \
        chmod +x /usr/local/bin/gosu; \
# verify that the binary works
        gosu --version; \
        gosu nobody true

WORKDIR /app

RUN set -ex; \
        addgroup --system --gid 1001 nodejs; \
        adduser --system --uid 1001 nodejs; \
# Set the correct permission for local cache
        mkdir .assets; \
        mkdir .temporary; \
        chown -R nodejs:nodejs /app

COPY --from=post-builder --chown=nodejs:nodejs /app/apps/nextjs-app/next.config.js \
        /app/apps/nextjs-app/next-i18next.config.js \
        /app/apps/nextjs-app/package.json \
        /app/apps/nextjs-app/.env \
        ./apps/nextjs-app/

COPY --from=post-builder --chown=nodejs:nodejs /app/apps/nextjs-app/.next ./apps/nextjs-app/.next
COPY --from=post-builder --chown=nodejs:nodejs /app/apps/nextjs-app/node_modules ./apps/nextjs-app/node_modules
COPY --from=post-builder --chown=nodejs:nodejs /app/apps/nextjs-app/public ./apps/nextjs-app/public

COPY --from=post-builder --chown=nodejs:nodejs /app/apps/nestjs-backend/dist ./apps/nestjs-backend/dist
COPY --from=post-builder --chown=nodejs:nodejs /app/apps/nestjs-backend/node_modules ./apps/nestjs-backend/node_modules
COPY --from=post-builder --chown=nodejs:nodejs /app/apps/nestjs-backend/package.json ./apps/nestjs-backend/

# mv it is necessary
COPY --from=builder --chown=nodejs:nodejs /app/packages/common-i18n/ ./packages/common-i18n/

COPY --from=post-builder --chown=nodejs:nodejs /app/packages ./packages
COPY --from=post-builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=post-builder --chown=nodejs:nodejs /app/package.json ./package.json

COPY --from=post-builder --chown=nodejs:nodejs /app/plugins/.next/standalone/plugins ./plugins
COPY --from=post-builder --chown=nodejs:nodejs /app/apps/nestjs-backend/static ./static

COPY --chown=nodejs:nodejs scripts/start.sh ./scripts/start.sh
COPY --chown=nodejs:nodejs scripts/db-migrate.mjs ./scripts/db-migrate.mjs
COPY --chown=nodejs:nodejs scripts/wait-for ./scripts/wait-for

ENV BUILD_VERSION=$BUILD_VERSION

RUN set -ex; \
        npm install -g zx; \
        apt-get update; \
        apt-get install -y --no-install-recommends \
                curl \
                ca-certificates \
                openssl \
                netcat-traditional \
                wget \
    	; \
    	rm -rf /var/lib/apt/lists/*; \
        ln -s /usr/local/lib/node_modules /node_modules

EXPOSE ${PORT}

ENTRYPOINT ["scripts/start.sh"]
