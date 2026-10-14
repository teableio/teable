# @ssa/notify — Gmail digest & event alerts

Companion service for the SSA Teable instance:

1. **Event alerts** — receives HMAC-signed record events (`record.created|updated|deleted`)
   from the backend (`POST /events`), matches them against rules, and sends
   emails / in-app bell notifications.
2. **Daily digest** — on a cron schedule (timezone aware), pulls configured
   table views through the Teable REST API and emails a summary (open tasks,
   overdue follow-ups, …) from Gmail via SMTP.

```
Teable backend ──HMAC webhook──▶ /events ──▶ rules ──▶ Gmail SMTP
                                              └──────▶ POST /api/ssa/notify (bell)
cron ──▶ Teable REST API ──▶ digest renderer ──▶ Gmail SMTP
```

## Run

```bash
cd ssa
pnpm install
cp .env.example .env        # fill in tokens (never commit .env)
cd services/notify
pnpm dev          # tsx watch on http://127.0.0.1:4600 (SSA_PORT)
```

Production: `pnpm build && node dist/index.js` (Docker/systemd/NSSM — it only
needs outbound SMTP/HTTP and inbound access from the Teable backend).

## Configuration

Environment variables are documented in [docs/ssa/ENVIRONMENT.md](../../../docs/ssa/ENVIRONMENT.md) §3.
Everything can come from `.env` (dev) or your host's secret manager; the service
reads plain env at boot, so any injector works — including
`npx wrangler secret put` if you later run it as a Cloudflare Worker variant.

Rules and digest layout are JSON files (git-ignored; examples committed):

```bash
cp notify.rules.example.json notify.rules.json
cp notify.digest.example.json notify.digest.json
```

- **`notify.rules.json`** — `rules[]` with `event`, optional `tableId`/`baseId`/
  `source`, `matchFields` (fieldId → expected value; a rule fires when one record
  carries every expected value — creates use full fields, updates use new
  values), and actions: `email[]`, `inApp{toUserId|toEmail, severity}`,
  `subject` template (`{{rule}}`, `{{event}}`, `{{tableId}}`, `{{recordCount}}`),
  `cooldownSeconds` (default 300; `0` = always).
- **`notify.digest.json`** — `subject`/`intro` + `sections[]` with
  `baseId`/`tableId`/`viewId?`, `take` (≤100), `columns[]` (field _names_; default
  first 4) and optional per-section `recipients`.

## HTTP endpoints

| Route              | Auth                   | Purpose                                         |
| ------------------ | ---------------------- | ----------------------------------------------- |
| `GET /healthz`     | none                   | config summary + last digest result             |
| `POST /events`     | `X-SSA-Signature` HMAC | backend event intake; 202 with fired rule names |
| `POST /digest/run` | `X-SSA-Token`          | run the digest immediately (testing/manual)     |

## Testing & safety

- `SSA_DRY_RUN=true` logs emails instead of sending them — use it while wiring
  up rules/recipients.
- The suite (`pnpm test`) covers HMAC verification, the rule engine (matching,
  cooldowns, templates) and digest rendering with no network access.
- Digest section failures are isolated: one broken view renders an error row in
  the email instead of dropping the whole digest.

## Notes

- The Teable REST token (`SSA_TEABLE_API_TOKEN`) is a personal access token
  created in the app (Settings → Personal Access Tokens). Create it with the
  user whose permissions should bound digest visibility.
- In-app notifications reuse the backend's `/api/ssa/notify` endpoint, so they
  appear in the bell instantly (Socket.IO-equivalent ShareDB push).
