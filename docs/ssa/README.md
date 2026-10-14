# SSA Single-Tenant Work App (fork of Teable CE)

This repository is a fork of [Teable Community Edition](https://github.com/teableio/teable)
(AGPL-3.0), maintained for a **single company** (SSA). It keeps every Teable feature
(grid / kanban / calendar / gallery / form views, realtime collaboration, comments,
record history, formulas, REST API, SQL query) and layers on the operations a
monday.com-style workflow needs:

| Capability                                                        | Where                                                          |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Real-time in-app notifications (bell) from business events        | `apps/nestjs-backend/src/features/ssa` + `ssa/services/notify` |
| Daily Gmail digest + event-based email alerts                     | `ssa/services/notify`                                          |
| In-app AI assistant (chat with your data, field drafting)         | `ssa/services/ai` + assistant drawer in `apps/nextjs-app`      |
| AI voice agent (real phone calls, call outcomes logged to tables) | `ssa/voice`                                                    |
| Single-tenant hardening (invite-only, no public signup)           | env `SSA_SINGLE_TENANT` + backend bootstrap                    |
| Free-tier deployment (Neon Postgres, local attachments)           | `docs/ssa/ENVIRONMENT.md`, `docs/ssa/DEPLOY.md`                |

Everything added by this fork is open source and lives under `ssa/` (plus small,
documented integration patches inside the Teable tree). No cloud storage service is
required: PostgreSQL (e.g. Neon free tier) is the only managed dependency; attachments
stay on local disk or a self-hosted MinIO, and email goes out over SMTP with a Gmail
App Password.

> **License / brand note:** Teable's brand assets (name, logo, identity) are protected
> and must not be removed or replaced. This fork keeps all Teable branding untouched;
> our additions are separate modules, themselves AGPL-3.0.

## Repository layout (fork additions)

```
docs/ssa/            # this documentation set (architecture, env, roadmap, deploy)
ssa/                 # SSA companion workspace (own pnpm workspace + lockfile)
├── services/notify/ # Gmail digests, event alerts, realtime notification bridge
├── services/ai/     # OpenAI-compatible assistant backend (chat + tools)
├── voice/           # Pipecat-based voice agent (Python)
└── docs/            # service-level runbooks
apps/nestjs-backend/src/features/ssa/   # event forwarder + internal notify API + hardening
apps/nextjs-app/src/features/app/components/assistant/  # assistant drawer UI
```

## Branch strategy (upstream-friendly)

| Branch             | Purpose                                                     |
| ------------------ | ----------------------------------------------------------- |
| `develop` / `main` | **Pristine mirrors of upstream Teable.** Never commit here. |
| `ssa/main`         | Our default branch. All SSA work lands here via small PRs.  |
| `ssa/mX-*`         | One short-lived branch per milestone (see `ROADMAP.md`).    |

Sync with upstream when desired:

```bash
git fetch upstream
git checkout ssa/main
git merge upstream/develop     # resolve conflicts, then push
```

## Quick start (development)

```bash
# 1. Teable monorepo
pnpm install
make switch-db-mode            # starts local Postgres + Redis via docker, runs migrations
cd apps/nestjs-backend && pnpm dev   # backend + Next.js frontend on http://localhost:3000

# 2. SSA companion services (optional per milestone)
cd ssa && pnpm install && pnpm -r dev
```

See `docs/ssa/ENVIRONMENT.md` for every environment variable, `docs/ssa/DEPLOY.md`
for the Neon + Docker deployment path and `docs/ssa/ROADMAP.md` for milestone status.
