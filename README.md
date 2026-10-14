<div align="center">
  <h1 align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="static/assets/images/teable-vertical-dark.png">
      <img alt="teable logo" height="120" src="static/assets/images/teable-vertical-light.png">
    </picture>
  </h1>
</div>

# SSA work app — single-tenant fork of Teable CE

A monday.com / Airtable-style work app for one company. Built on
[Teable Community Edition](https://github.com/teableio/teable) (AGPL-3.0):
PostgreSQL underneath, grid / kanban / calendar / gallery / form views,
realtime collaboration, comments, record history, formulas and a full REST API.

This fork keeps that core untouched and adds the operations a small business
actually runs on:

| Capability                                                                 | Where                                                          |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Real-time bell notifications from record events (create / update / delete) | `apps/nestjs-backend/src/features/ssa` + `ssa/services/notify` |
| Daily Gmail digest + event-based email alerts (Gmail App Password SMTP)    | `ssa/services/notify`                                          |
| In-app AI assistant (chat with your data, read/write tools, streaming)     | `ssa/services/ai` + assistant drawer in `apps/nextjs-app`      |
| AI voice agent (real phone calls, outcomes logged into tables)             | `ssa/voice` (Pipecat, open source)                             |
| Invite-only single-tenant hardening                                        | `SSA_SINGLE_TENANT=true`                                       |
| Operator branding (name/logo via `SSA_BRAND_NAME` / `SSA_BRAND_LOGO`)      | `docs/ssa/BRANDING.md`                                         |

Everything added lives in `ssa/` plus small, documented integration patches in
the Teable tree. No cloud storage service is required: PostgreSQL (e.g. Neon
free tier) is the only managed dependency; attachments stay on local disk (or
self-hosted MinIO) and email goes out over any SMTP account.

## Documentation

| Doc                                                    | Contents                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| [`docs/ssa/README.md`](docs/ssa/README.md)             | Fork overview, component map, branch strategy                       |
| [`docs/ssa/DEPLOY.md`](docs/ssa/DEPLOY.md)             | Deployment runbook (Neon, Docker, Gmail, first-boot checklist, FAQ) |
| [`docs/ssa/ENVIRONMENT.md`](docs/ssa/ENVIRONMENT.md)   | Every environment variable + secrets catalogue                      |
| [`docs/ssa/ARCHITECTURE.md`](docs/ssa/ARCHITECTURE.md) | How the pieces fit together (events, assistant, voice)              |
| [`docs/ssa/BRANDING.md`](docs/ssa/BRANDING.md)         | What may / may not change regarding branding                        |
| [`docs/ssa/ROADMAP.md`](docs/ssa/ROADMAP.md)           | Milestones M0–M6 and their verification                             |

## Quick start (development)

```bash
pnpm install
make switch-db-mode                  # local Postgres + Redis via docker, runs migrations
cd apps/nestjs-backend && pnpm dev   # backend + web app on http://localhost:3000

cd ../../ssa && pnpm install && pnpm -r dev   # companion services (notify :4600, ai :4700)
```

## Branches

| Branch             | Purpose                                                 |
| ------------------ | ------------------------------------------------------- |
| `develop` / `main` | Pristine mirrors of upstream Teable — never commit here |
| `ssa/main`         | Default branch: all SSA work lands here via small PRs   |
| `ssa/mX-*`         | Short-lived milestone branches (see the roadmap)        |

Upstream sync:

```bash
git fetch upstream
git checkout ssa/main
git merge upstream/develop
```

## License

AGPL-3.0 — this repository is the Teable Community Edition (packages under
`packages/` are MIT). Teable's brand assets (name, logo, visual identity) are
protected and must not be modified or removed; see `LICENSE` and
[`docs/ssa/BRANDING.md`](docs/ssa/BRANDING.md). All SSA additions are separate
modules under the same license.

Upstream project: <https://github.com/teableio/teable> · Help: <https://help.teable.ai>
