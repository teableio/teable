# Environment & secrets catalogue

Two layers: **Teable core** (upstream envs, used unchanged) and **SSA** (our modules).
Everything below is plain environment configuration — no config files with secrets are
ever committed. In production set them via your host's secret mechanism (Render env
vars, Docker `env_file`, Infisical, or Cloudflare `npx wrangler secret put` for the
optional Workers deployment of the notify service).

## 1. Teable core (required to run)

| Variable                                                        | Example / notes                                                                                                                                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                      | `production`                                                                                                                                                                                        |
| `PORT`                                                          | `3000` (API + UI share it in production)                                                                                                                                                            |
| `SOCKET_PORT`                                                   | `3000` in production (realtime served on same port)                                                                                                                                                 |
| `PUBLIC_ORIGIN`                                                 | `https://workspace.example.com` — used in emails and links                                                                                                                                          |
| `PRISMA_DATABASE_URL`                                           | `postgresql://user:pass@host/db?sslmode=require&statement_cache_size=0` — Neon connection string fits directly                                                                                      |
| `BACKEND_CACHE_REDIS_URI`                                       | `redis://:password@127.0.0.1:6379/0` (required by BullMQ even single-instance)                                                                                                                      |
| `BACKEND_STORAGE_PROVIDER`                                      | `local` (default) — attachments on disk. Use `minio` with a self-hosted MinIO if you need object storage                                                                                            |
| `BACKEND_STORAGE_LOCAL_PATH`                                    | e.g. `/data/attachments` (mount a volume)                                                                                                                                                           |
| `BACKEND_JWT_SECRET`, `BACKEND_SESSION_SECRET`, `SECRET_KEY`, … | See `apps/nestjs-backend/src/configs/secrets/secret-specs.ts`. Generate with `openssl rand -base64 32`. Dev falls back to insecure defaults with a boot warning — **set real values in production** |

### 1.1 Gmail SMTP (App Password)

```env
BACKEND_MAIL_HOST=smtp.gmail.com
BACKEND_MAIL_PORT=465
BACKEND_MAIL_SECURE=true
BACKEND_MAIL_SENDER=you@yourdomain.com      # must match the Gmail account (or a Workspace alias)
BACKEND_MAIL_SENDER_NAME=SSA
BACKEND_MAIL_AUTH_USER=you@yourdomain.com
BACKEND_MAIL_AUTH_PASS=xxxxxxxxxxxxxxxx     # 16-char Google App Password
```

Getting an App Password: Google Account → Security → 2-Step Verification (enable) →
App passwords → create one for “Mail”. Works for personal Gmail and Google Workspace.
Teable uses this for invites / verification / password resets; the SSA notify service
uses the same credentials for digests and alerts (`GMAIL_*` variables below).

### 1.2 Single-tenant hardening (provided by this fork)

| Variable                      | Default | Purpose                                                                                                             |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `SSA_SINGLE_TENANT`           | `false` | When `true` the backend forces `disallowSignUp=true` and disables the waitlist at every boot → invite-only instance |
| `SSA_DISABLE_PASSWORD_SIGNIN` | `false` | Optional: also set `PASSWORD_LOGIN_DISABLED=true` semantics (maps to upstream env)                                  |

## 2. SSA `features/ssa` integration (backend patch, M1/M2)

| Variable                    | Example                          | Purpose                                                                        |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------ |
| `SSA_INTERNAL_TOKEN`        | long random string               | Shared secret for `X-SSA-Token` on `/api/ssa/*`; unset ⇒ internal API disabled |
| `SSA_EVENTS_WEBHOOK_URL`    | `http://127.0.0.1:4600/events`   | Where record events are POSTed; unset ⇒ forwarding off                         |
| `SSA_EVENTS_WEBHOOK_SECRET` | long random string               | HMAC-SHA256 key for `X-SSA-Signature`                                          |
| `SSA_EVENTS_TABLES`         | optional comma list of table ids | Optional allow-list to limit forwarded tables                                  |
| `SSA_EVENTS_TIMEOUT_MS`     | `3000`                           | Forward timeout; events are dropped (logged) after this                        |

## 3. `ssa/services/notify` (M3)

| Variable                            | Example                                 | Purpose                                                   |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------- |
| `SSA_PORT`                          | `4600`                                  | HTTP port                                                 |
| `SSA_BIND`                          | `127.0.0.1`                             | Bind address                                              |
| `SSA_LOG_LEVEL`                     | `info`                                  | `debug` \| `info` \| `warn` \| `error`                    |
| `SSA_INTERNAL_TOKEN`                | same as backend                         | Guards `/digest/run`; used for `/api/ssa/notify` calls    |
| `SSA_EVENTS_WEBHOOK_SECRET`         | same as backend                         | Verifies incoming events                                  |
| `SSA_TEABLE_BASE_URL`               | `http://127.0.0.1:3000`                 | Teable origin for REST calls                              |
| `SSA_TEABLE_API_TOKEN`              | `teable_pat_…`                          | Personal access token (Settings → Personal Access Tokens) |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | `you@yourdomain.com` / 16 chars         | SMTP send                                                 |
| `GMAIL_SENDER_NAME`                 | `SSA`                                   | Display name                                              |
| `SSA_DIGEST_CRON`                   | `0 8 * * *`                             | Daily digest schedule (cron)                              |
| `SSA_DIGEST_TZ`                     | `Asia/Kuala_Lumpur`                     | Timezone for cron + digest date                           |
| `SSA_DIGEST_RECIPIENTS`             | `ops@yourdomain.com,ceo@yourdomain.com` | Digest recipients                                         |
| `SSA_RULES_FILE`                    | `notify.rules.json`                     | Event → email/in-app rules                                |
| `SSA_DIGEST_FILE`                   | `notify.digest.json`                    | Which tables/views the digest summarises                  |
| `SSA_DRY_RUN`                       | `false`                                 | `true` ⇒ log emails instead of sending (safe testing)     |

Service endpoints: `GET /healthz` · `POST /events` (HMAC) · `POST /digest/run`
(`X-SSA-Token`). See `ssa/services/notify/README.md` for the rules/digest file
formats.

## 4. `ssa/services/ai` (M4)

| Variable                                       | Example                                                                                    | Purpose                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `SSA_PORT`                                     | `4700`                                                                                     | HTTP port                                                   |
| `SSA_AI_BASE_URL`                              | `https://opencode.ai/zen/v1` / `https://api.deepseek.com/v1` / `http://localhost:11434/v1` | **OpenAI-compatible** endpoint (OpenCode gateway preferred) |
| `SSA_AI_API_KEY`                               | `sk-…`                                                                                     | Key for that endpoint                                       |
| `SSA_AI_MODEL`                                 | `deepseek-v4.1-flash` / `deepseek-chat` / `qwen2.5:14b`                                    | Model id                                                    |
| `SSA_AI_TEMPERATURE`                           | `0.2`                                                                                      | Optional                                                    |
| `SSA_AI_MAX_STEPS`                             | `8`                                                                                        | Tool-call loop ceiling                                      |
| `SSA_INTERNAL_TOKEN`                           | same as backend                                                                            | Guards the proxy ↔ service boundary                        |
| `SSA_TEABLE_BASE_URL` / `SSA_TEABLE_API_TOKEN` | as above                                                                                   | Tool data access (use a scoped token)                       |
| `SSA_AI_SYSTEM_PROMPT`                         | optional                                                                                   | Extra operator instructions                                 |

In the web app, expose only non-secret values to Next.js:

```env
SSA_ASSISTANT_ENABLED=true
SSA_ASSISTANT_SERVICE_URL=http://127.0.0.1:4700
SSA_INTERNAL_TOKEN=<same token>
```

## 5. `ssa/voice` (M5)

| Variable                                                         | Example                    | Purpose                                      |
| ---------------------------------------------------------------- | -------------------------- | -------------------------------------------- |
| `SSA_AI_BASE_URL` / `SSA_AI_API_KEY` / `SSA_AI_MODEL`            | as above                   | LLM inside the voice pipeline                |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | carrier credentials        | Telephony mode (Twilio)                      |
| `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_PHONE_NUMBER`        | alternative carrier        | Telephony mode (Plivo)                       |
| `DEEPGRAM_API_KEY`                                               | STT (or use local Whisper) | Speech recognition                           |
| `ELEVENLABS_API_KEY` / `CARTESIA_API_KEY`                        | TTS (or Piper local)       | Speech synthesis                             |
| `SSA_VOICE_MODE`                                                 | `local` \| `telephony`     | `local` = mic/speaker demo, no carrier costs |
| `SSA_TEABLE_BASE_URL` / `SSA_TEABLE_API_TOKEN`                   | as above                   | Logging call outcomes into tables            |

## 6. Neon (free Postgres) — 5 minute setup

1. Create an account at <https://neon.tech> → “New project”.
2. Copy the **connection string** (it already contains `sslmode=require`).
3. Append `&statement_cache_size=0` (Prisma/pgBouncer friendly), e.g.

   ```
   PRISMA_DATABASE_URL=postgresql://neondb_owner:…@ep-…aws.neon.tech/neondb?sslmode=require&statement_cache_size=0
   ```

4. Put it in `.env` / deployment secrets. Teable migrations run automatically on boot
   (`prisma migrate deploy`), creating its metadata schema plus one schema per base.

Free-tier notes: Neon free projects scale to zero after inactivity (first request wakes
them; expect a cold-start second or two) and include ~0.5 GB storage — plenty for a
small operator team, upgrade later without changing any config.

## 7. Where do the values live at runtime?

| Context                               | Mechanism                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| Local dev                             | `apps/nextjs-app/.env.development.local` (git-ignored) + `ssa/.env` (git-ignored) |
| Docker compose                        | `dockers/examples/standalone/.env` + service `env_file`                           |
| Render/misc host                      | host env vars (never committed)                                                   |
| Cloudflare Workers (optional, notify) | `npx wrangler secret put GMAIL_APP_PASSWORD` etc.                                 |
