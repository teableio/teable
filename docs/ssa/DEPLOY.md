# Deploying the SSA stack

Target: a **single-tenant** deployment of Teable CE + the three SSA companion
services, with **Neon free Postgres** as the only managed dependency and Gmail
for email. Everything else runs on your own host (VPS, office machine, or a
container platform).

```
                    ┌────────────────────────── your host / VPS ──────────────────────────┐
Internet users ──▶  │ reverse proxy (Caddy/nginx + TLS)                                   │
                    │   └─▶ teable (NestJS+Next, :3000)  ──▶ redis (:6379)                │
                    │            │        ▲                    local attachments volume   │
                    │            │        │ HMAC events                                 │
                    │            ▼        │                                             │
                    │        ssa-notify (:4600) ──▶ Gmail SMTP                            │
                    │            ▲                                                       │
                    │   UI ──▶ ssa-ai (:4700) ──▶ LLM endpoint                           │
                    │        ssa-voice (Python, outbound only)                           │
                    └──────────────────────────┬──────────────────────────────────────────┘
                                               ▼
                              Neon Postgres (free tier, sslmode=require)
```

## 0. Prerequisites

- A host that stays on (digests/cron need it). Docker + Compose installed.
- A domain (for TLS + `PUBLIC_ORIGIN`; email links and the assistant need it).
- Gmail account with 2FA + an App Password (docs/ssa/ENVIRONMENT.md §1.1).
- Neon account (docs/ssa/ENVIRONMENT.md §6) — copy the connection string.
- Optional: LLM key (OpenCode gateway / DeepSeek), carrier + STT/TTS keys for
  voice.

## 1. Secrets first

Generate the internal secrets once (openssl or any random source):

```bash
openssl rand -hex 32   # SSA_INTERNAL_TOKEN
openssl rand -hex 32   # SSA_EVENTS_WEBHOOK_SECRET
openssl rand -base64 32  # BACKEND_JWT_SECRET / BACKEND_SESSION_SECRET / SECRET_KEY
```

Never commit them. On Docker they live in `.env` files on the host; on any
PaaS they go into the platform's secret store. (If you deploy a service as a
Cloudflare Worker variant, use `npx wrangler secret put NAME`.)

## 2. Compose deployment (recommended)

`dockers/examples/standalone/` in this repo is the upstream baseline; extend it
for SSA like this (create `ssa/docker-compose.ssa.yaml` on the host — not
committed if you keep secrets there):

```yaml
services:
  teable:
    image: ghcr.io/teableio/teable:latest
    restart: always
    ports: ["127.0.0.1:3000:3000"] # expose only to the reverse proxy
    volumes: ["teable-data:/app/.assets"]
    env_file: [./teable.env]
    depends_on:
      teable-cache: { condition: service_healthy }

  teable-cache:
    image: redis:7.2.4
    restart: always
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}

  ssa-notify:
    build: ./ssa/services/notify # image: node:22 + pnpm build
    restart: always
    env_file: [./ssa-notify.env] # ports 4600 internal only
    depends_on: [teable]

  ssa-ai:
    build: ./ssa/services/ai
    restart: always
    env_file: [./ssa-ai.env] # ports 4700 internal only
    depends_on: [teable]

volumes: { teable-data: {}, redis-data: {} }
```

`teable.env` (see docs/ssa/ENVIRONMENT.md §1 for every variable):

```env
NODE_ENV=production
PUBLIC_ORIGIN=https://workspace.example.com
PRISMA_DATABASE_URL=postgresql://…@ep-…neon.tech/neondb?sslmode=require&statement_cache_size=0
BACKEND_CACHE_REDIS_URI=redis://:${REDIS_PASSWORD}@teable-cache:6379/0
BACKEND_STORAGE_PROVIDER=local
BACKEND_STORAGE_LOCAL_PATH=/app/.assets
BACKEND_MAIL_HOST=smtp.gmail.com
BACKEND_MAIL_PORT=465
BACKEND_MAIL_SECURE=true
BACKEND_MAIL_SENDER=bot@yourdomain.com
BACKEND_MAIL_AUTH_USER=bot@yourdomain.com
BACKEND_MAIL_AUTH_PASS=…            # Gmail App Password
BACKEND_JWT_SECRET=…
BACKEND_SESSION_SECRET=…
SECRET_KEY=…
SSA_SINGLE_TENANT=true
SSA_INTERNAL_TOKEN=…
SSA_EVENTS_WEBHOOK_URL=http://ssa-notify:4600/events
SSA_EVENTS_WEBHOOK_SECRET=…
SSA_ASSISTANT_ENABLED=true
SSA_ASSISTANT_SERVICE_URL=http://ssa-ai:4700
```

`ssa-notify.env` / `ssa-ai.env`: mirror docs/ssa/ENVIRONMENT.md §3/§4, using
the service hostnames (`SSA_TEABLE_BASE_URL=http://teable:3000`).

Put TLS in front with Caddy:

```
workspace.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Then: `docker compose -f ssa/docker-compose.ssa.yaml up -d --build`.

## 3. First-boot checklist

1. Open the site → **sign up the first account** (the backend runs migrations
   on Neon automatically). `SSA_SINGLE_TENANT=true` disables further signups.
2. Settings → **Personal Access Tokens**: create one scoped token for the
   notify service (`base|read`, `table|read`, `record|read` + `record|update`)
   and one for tools/voice (add `table|create`, `field|create`,
   `record|create`) → paste into the service env files and restart them.
3. Create your first base/tables in the UI (grid/kanban/calendar views work out
   of the box), invite teammates.
4. Configure notify: copy `ssa/services/notify/notify.*.example.json` to real
   files, set table/field ids (visible in the URL), recipients; keep
   `SSA_DRY_RUN=true` for a day, watch the logs, then flip it off.
5. Configure the assistant on `/admin/setting` (or via env) and verify:
   `curl -X POST -H "X-SSA-Token: $SSA_INTERNAL_TOKEN" http://localhost:3000/api/ssa/health`.
6. Verify Gmail end-to-end: `curl -X POST -H "X-SSA-Token: $SSA_INTERNAL_TOKEN" http://ssa-notify:4600/digest/run`
   (dry-run first), then check the inbox after disabling dry-run.

## 4. Voice (§voice)

1. Create the Call Log table: `cd ssa/voice && python scripts/setup_call_log.py --base bse…`,
   paste `SSA_CALL_LOG_TABLE_ID` into `.env`. Prove logging with
   `python scripts/log_test_call.py` (no carrier needed).
2. Local voice test (mic/speaker, needs `DEEPGRAM_API_KEY` + `CARTESIA_API_KEY`):
   `pip install -r requirements.txt && SSA_VOICE_MODE=local python src/bot.py`.
3. Telephony: buy a Twilio number (or Plivo), point its voice webhook /
   Media Streams URL at the voice service (expose it via the reverse proxy or
   ngrok for tests), and run `SSA_VOICE_MODE=telephony`. See
   `ssa/services/voice/README.md` for provider swaps (local Whisper/Piper work
   without third-party STT/TTS). Costs: Twilio numbers ≈ $1.15/mo + per-minute.
4. Compliance: keep the AI disclosure line enabled and follow local rules for
   recording consent.

## 5. Operations

| Task                       | Command / action                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upgrade Teable (upstream)  | `git fetch upstream && git merge upstream/develop` on a `sync` branch → test → merge to `ssa/main`; pull + `docker compose up -d --build`                           |
| Upgrade companion services | just deploy `ssa/main`; they are small Node/Python services                                                                                                         |
| Backups                    | Neon: built-in PITR on branches; additionally `pg_dump "$PRISMA_DATABASE_URL" > backup.sql` via a cron on your host; attachments: snapshot the `teable-data` volume |
| Logs                       | `docker compose logs -f teable ssa-notify ssa-ai` (compose adds container names)                                                                                    |
| Health                     | `GET /api/ssa/health` (backend), `GET :4600/healthz` (notify), `GET :4700/healthz` (ai)                                                                             |

### Redeploys & data persistence (FAQ)

**Does redeploying wipe data? No.** The app is stateless; every piece of state
lives outside it:

| State                                          | Lives in                                                                   | Survives redeploy?                           |
| ---------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| Users, settings, all records                   | PostgreSQL (Neon, or the `teable-db` container's volume when self-hosting) | ✅ always — deploys never touch the database |
| Attachments (`BACKEND_STORAGE_PROVIDER=local`) | host disk — **must be a persistent volume** (or self-hosted MinIO)         | ✅ with a volume / ❌ on ephemeral disks     |
| Redis (cache, BullMQ queues, ShareDB pub/sub)  | `teable-cache` container                                                   | disposable by design — no durable data       |

What actually happens at boot — two separate things, neither destructive:

1. **Migrations** — the official image entrypoint (`scripts/start.sh`) runs
   `node scripts/db-migrate.mjs` → `prisma migrate deploy` for the meta + data
   schemas **before** the app starts, serialised by a Postgres advisory lock
   (`scripts/postgres-migrate-lock.mjs`). `migrate deploy` applies only pending
   migrations recorded in `_prisma_migrations`; it never drops or resets data.
   (Image supports `start.sh skip-migrate` / `migrate-only` if you want to run
   migrations as a separate deploy step.)
2. **`SsaBootstrapService` ("enforced at boot")** — re-asserts exactly four
   instance settings **only when their stored values differ**:
   `disallowSignUp` / `enableWaitlist` (single-tenant mode) and
   `brandName` / `brandLogo` (branding). It reads first, writes on mismatch,
   and is idempotent — it cannot touch business data.
   See `apps/nestjs-backend/src/features/ssa/ssa-bootstrap.service.ts`.

**Can this run on Cloudflare Workers instead, split into "db worker" +
"webapp worker"?** No, for two separate reasons:

- **Teable is not Workers-compatible.** It needs long-lived TCP connections
  (Postgres, Redis), background workers (BullMQ), a persistent Node process
  for ShareDB/websockets, and the entrypoint is a shell script that shells out
  to Prisma. Workers are short-lived isolates with an ephemeral filesystem and
  no shell — even with `nodejs_compat` this stack does not run there.
- **A "db worker" cannot exist.** Workers cannot host PostgreSQL. Anything you
  write inside a Worker's filesystem is lost when it redeploys — that's exactly
  why state must live in an external database.

The "two parts" idea is right, though — and it already is the architecture:
the **app** (stateless, redeployable anytime) plus a **separate database
service**. That database service is Neon (managed Postgres) in the recommended
setup, or the `teable-db` container with a persistent Docker volume when
self-hosting. Cloudflare Workers are only viable for small **stateless** jobs
(e.g. the optional digest-cron variant) that talk to Neon/Teable over HTTP;
they would hold no data themselves.

### Troubleshooting (issues actually hit while building this)

| Symptom                                    | Cause / fix                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/events` or `/digest/run` hang            | Fastify v5: `preHandler` must be **async** (fixed in our code; keep it that way if you edit)                                                |
| Digest section shows HTTP 400 `cellFormat` | The records API accepts `text`/`json`, not `string`                                                                                         |
| Assistant drawer missing                   | `SSA_ASSISTANT_ENABLED`/`SSA_ASSISTANT_SERVICE_URL` missing on the backend, or the user is not signed in                                    |
| Events not arriving                        | Check `SSA_EVENTS_WEBHOOK_URL`/`_SECRET` match on both sides; updates from API tokens without a UI window id are not forwarded (documented) |
| `tsc` reports ~227 errors                  | Pre-existing in the CE snapshot (test files); our files must stay clean — compare counts before/after                                       |
| First request slow                         | Neon free tier scales to zero; the first query wakes it                                                                                     |

## 6. What is intentionally NOT included

- No cloud object storage: attachments stay on disk (or self-hosted MinIO via
  `BACKEND_STORAGE_PROVIDER=minio`, all open source).
- No paid SaaS in the core loop: SMTP is your Gmail, the LLM is any
  OpenAI-compatible endpoint (local Ollama is fine), telephony is the only
  optional paid dependency.
- Teable brand assets stay intact (AGPL §7(e)); all SSA additions are separate
  modules.
