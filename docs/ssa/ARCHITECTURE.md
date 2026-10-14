# Architecture — SSA single-tenant deployment

## Context

```mermaid
flowchart LR
    subgraph Internet
        U["Team browsers"]
        G["Gmail SMTP (app password)"]
        LLM["LLM endpoint (OpenCode gateway / DeepSeek / Ollama)"]
        PSTN["Phone callers"]
        CARRIER["Telephony carrier (Twilio / Plivo)"]
    end

    subgraph Host["SSA host (Docker / Node 22+, single tenant)"]
        WEB["apps/nextjs-app + apps/nestjs-backend\n(Nest + Next on :3000, ShareDB realtime)"]
        REDIS["Redis (cache + BullMQ)"]
        NOTIFY["ssa/services/notify\n(digest cron + event alerts)"]
        AI["ssa/services/ai\n(assistant + tool calling)"]
        VOICE["ssa/voice\n(Pipecat agent worker)"]
        FILES["Local attachments (or self-hosted MinIO)"]
    end

    PG[("PostgreSQL\n(Neon free tier or self-hosted)")]

    U -->|HTTP/WebSocket| WEB
    WEB --> REDIS
    WEB --> PG
    WEB --> FILES
    WEB -->|"HMAC webhook events"| NOTIFY
    NOTIFY -->|"SMTP"| G
    NOTIFY -->|"in-app notify API"| WEB
    U -->|"/api/assistant proxy"| AI
    AI --> LLM
    AI -->|REST + token| WEB
    PSTN --> CARRIER --> VOICE
    VOICE --> LLM
    VOICE -->|REST + token| WEB
```

## Components

### 1. Teable core (unmodified upstream except the small `features/ssa` patch)

- `apps/nestjs-backend` — NestJS API + serves the built/served Next.js app; stores data in
  PostgreSQL (one schema per base); realtime via **ShareDB over SockJS** on `/socket`.
- `apps/nextjs-app` — Next.js Pages Router UI. Auth is session-cookie based; all API calls
  are same-origin `/api`.
- Redis is required in practice (BullMQ outbox + cache); it is self-hosted, not a cloud
  service.
- Notifications already exist upstream: a `notification` table, `GET /api/notifications`
  endpoints, a bell UI, and a realtime presence channel `__notification_user_<id>`.
  Our patch reuses `NotificationService.sendCommonNotify()` so companion services can
  raise bell notifications that appear instantly.

### 2. `features/ssa` (inside `apps/nestjs-backend`) — the only core patch

| Piece | Responsibility |
|---|---|
| `ssa.module.ts` | wires controller/service/listener |
| `ssa-bootstrap.service.ts` | when `SSA_SINGLE_TENANT=true`: forces `disallowSignUp=true`, disables waitlist; idempotent on every boot |
| `ssa-events.listener.ts` | subscribes `table.record.create/update/delete`, forwards a compact event JSON to `SSA_EVENTS_WEBHOOK_URL` with HMAC (`SSA_EVENTS_WEBHOOK_SECRET`); bounded payload/size/timeout; fire-and-forget |
| `ssa.controller.ts` | `GET /api/ssa/health`, `POST /api/ssa/notify` (shared-secret header `SSA_INTERNAL_TOKEN`) → bell notification via NotificationService |

Design rules: the listener never blocks the request path; failures are logged, not
rethrown; the internal API is disabled when `SSA_INTERNAL_TOKEN` is unset.

### 3. `ssa/services/notify` (Node + Fastify)

- `POST /events` — HMAC-verified Teable events; a small rule engine maps record events to
  notifications (subscribe rules in `ssa/services/notify/notify.rules.json`), then:
  email via nodemailer (Gmail SMTP) and/or in-app via `POST /api/ssa/notify`.
- `cron` (node-cron) — daily digest: pull configured views/tables from the Teable REST
  API (personal access token), render an HTML summary (created today / due today /
  overdue / assigned to me), send one email per recipient to Gmail.
- `GET /healthz` — liveness + last digest run info.

### 4. `ssa/services/ai` (Node + Fastify)

- OpenAI-compatible chat client (`SSA_AI_BASE_URL`, `SSA_AI_API_KEY`, `SSA_AI_MODEL`,
  `SSA_AI_TEMPERATURE`). Works with the OpenCode gateway, DeepSeek, or a local Ollama
  (`http://host:11434/v1`).
- Tool calling against the Teable REST API with a scoped token: `list_tables`,
  `get_table_schema`, `query_records`, `create_record`, `update_record`, `summarize_table`.
- `POST /chat` streams SSE; the web app calls it through the Next.js route
  `/api/assistant/*` proxy so the API key never reaches the browser and sessions are
  same-origin.

### 5. `ssa/voice` (Python + Pipecat)

- Voice pipeline: carrier (Twilio Media Streams or Plivo) → STT → LLM (same configurable
  endpoint) → TTS, with tool calls that log outcomes into Teable (call log table:
  contact, direction, outcome, summary, recording URL).
- Modes: `local` (mic/speaker demo, no carrier costs) and `telephony`.
- The carrier is the one paid external dependency; the framework (Pipecat, BSD-2) and
  providers can be swapped per env.

## Security model (single tenant)

- **No public signup**: `SSA_SINGLE_TENANT=true` forces `disallowSignUp` + waitlist off;
  accounts are created via invitations only.
- **Service-to-service auth**: every companion→backend call carries
  `X-SSA-Token: <SSA_INTERNAL_TOKEN>`; every backend→notify event carries an
  `X-SSA-Signature` HMAC of the raw body (`SSA_EVENTS_WEBHOOK_SECRET`).
- **LLM key** stays in the `ssa/services/ai` process (server side only).
- **Teable API token** used by companion services is a scoped personal access token;
  rotate via the admin UI, store only in `.env`/deployment secrets.
- Companion services bind to localhost by default (`127.0.0.1`) and are reached through
  the reverse proxy or internal network only.

## Storage

- PostgreSQL is the single source of truth (Neon free tier is fine for a small team;
  any Postgres 15+ works). No other cloud storage is used: attachments live on local
  disk by default (`BACKEND_STORAGE_PROVIDER=local`) or on self-hosted MinIO.
- Redis runs alongside the app (docker-compose) and holds only cache/queue state.
