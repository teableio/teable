# Roadmap — SSA milestones

Each milestone ships as its own branch + pull request against `ssa/main` (small,
reviewable pushes — never one giant commit). Branch naming: `ssa/mX-<slug>`.

| #   | Branch                 | Deliverable                                                                                                                         | Status  |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- |
| M0  | `ssa/m0-bootstrap`     | Docs skeleton, `ssa/` workspace, roadmap, env catalogue                                                                             | ✅ done |
| M1  | `ssa/m1-single-tenant` | Backend `features/ssa` module, `SSA_SINGLE_TENANT` hardening (invite-only), env validation + config                                 | ✅ done |
| M2  | `ssa/m2-events-bridge` | Event forwarder (v1 `operation.records.*` + v2 domain events → HMAC webhook) + internal notification API used by companion services | ✅ done |
| M3  | `ssa/m3-notify`        | `ssa/services/notify`: daily Gmail digest (cron), event alerts, in-app notify bridge, CI for `ssa/**`                               | ✅ done |
| M4  | `ssa/m4-ai-assistant`  | `ssa/services/ai` (OpenAI-compatible, env-configured) + assistant drawer in the web app + session-gated backend proxy               | ✅ done |
| M5  | `ssa/m5-voice-agent`   | `ssa/voice`: Pipecat voice agent (inbound/outbound), tool calls into tables, carrier runbook                                        | ✅ done |
| M6  | `ssa/m6-handoff`       | Deployment runbook finalisation (Neon), screenshots, operator handbook                                                              | ⏳      |

## Milestone acceptance criteria (short form)

- **M1** — with `SSA_SINGLE_TENANT=true`, a fresh instance boots with `disallowSignUp`,
  no waitlist, and accepts users only via invitation; documented in `ENVIRONMENT.md`.
- **M2** — with `SSA_EVENTS_WEBHOOK_URL` set, record create/update/delete events are
  POSTed (HMAC-signed, bounded size/timeout) to the companion service; replayed
  failures never crash the API. `POST /api/ssa/notify` creates a bell notification
  (shared-secret guarded) and pushes it over the realtime channel.
- **M3** — `notify` service sends a daily digest at the configured cron to Gmail
  (App Password SMTP), converts subscribed record events into email + in-app
  notifications, and has unit tests + CI.
- **M4** — assistant drawer answers questions grounded in the current base/table via
  `SSA_AI_BASE_URL` (OpenCode gateway / DeepSeek / Ollama all valid), can create and
  update records through tools, streams responses, and degrades gracefully when the
  LLM endpoint is unset.
- **M5** — voice worker can run in local (mic) mode and telephony mode (Twilio/Plivo
  SIP/Media Streams), calls the LLM with configurable base URL, and writes structured
  call outcomes (transcript summary, disposition) into a Teable table.
- **M6** — a fresh operator can deploy the whole stack from the docs alone on a free
  Neon Postgres + any always-on host, with Gmail digests verified end-to-end.
