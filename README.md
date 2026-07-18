<div align="center">
  <h1 align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="static/assets/images/teable-vertical-dark.png">
      <img alt="teable logo" height="150" src="static/assets/images/teable-vertical-light.png">
    </picture>
  </h1>
  <h3 align="center"><strong>Turn your data into AI workflows and custom apps that 100% fit your business</strong></h3>
  <p>One platform where data management, AI workflows, and app building come together — spreadsheet-simple on the surface, real PostgreSQL underneath. Agents work inside your live data and real processes, so what they build lands seamlessly and fits your business exactly. In the cloud or fully self-hosted.</p>
  <p>Try out Teable using our hosted version at <a href="https://teable.ai">teable.ai</a></p>
</div>

<div align="center">
<a href="https://trendshift.io/repositories/8516" target="_blank"><img src="https://trendshift.io/api/badge/repositories/8516" alt="teableio%2Fteable | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</div>

<p align="center">
  <a target="_blank" href="https://teable.ai">Home</a> | <a target="_blank" href="https://help.teable.ai">Help</a> | <a target="_blank" href="https://teable.ai/blog">Blog</a> | <a target="_blank" href="https://teable.ai/templates">Template</a> | <a target="_blank" href="https://help.teable.ai/en/api-doc/token">API</a> | <a target="_blank" href="https://community.teable.ai">Community</a> | <a target="_blank" href="https://x.com/teableio">X</a>
</p>

<p align="center">
  <a aria-label="Build" href="https://github.com/teableio/teable/actions?query=Build%20and%20Push%20to%20Docker%20Registry">
    <img alt="build" src="https://img.shields.io/github/actions/workflow/status/teableio/teable/docker-push.yml?label=Build&logo=github&style=flat-quare&labelColor=000000" />
  </a>
  <a aria-label="Codacy grade" href="https://www.codacy.com/gh/teableio/teable/dashboard?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=teableio/teable&amp;utm_campaign=Badge_Grade">
    <img alt="Codacy grade" src="https://img.shields.io/codacy/grade/dff9c944af284a0fad4e165eb1727467?logo=codacy&style=flat-square&labelColor=000&label=Codacy">
  </a>
  <a aria-label="Top language" href="https://github.com/teableio/teable/search?l=typescript">
    <img alt="GitHub top language" src="https://img.shields.io/github/languages/top/teableio/teable?style=flat-square&labelColor=000&color=blue">
  </a>
</p>

## Quick Guide

1. Want to see it in action? Try Teable on our hosted cloud at [teable.ai](https://teable.ai).
2. Deploying it yourself? Start from the [Deployment guide](https://help.teable.ai/en/deploy/choose) — standalone in minutes, or the full AI platform on your own machines.

## Four platforms in one

AI chat, App Builder, and app deployments are part of Teable, not bolt-ons.
Self-hosting Teable deploys four platforms in one:

- **A secure, scalable agent sandbox** — every AI session runs in its own isolated container, started on demand and gone when the session ends.
- **A resource-efficient app deployment platform** — every app your team builds and publishes runs as its own lightweight, long-lived container.
- **An AI workflow engine** — automations triggered by record changes, schedules, and webhooks, with AI steps, running right where your data lives.
- **A full-featured database collaboration platform on PostgreSQL** — tables, views, permissions, and API.

Self-hosting wraps your own compute into an **agent-ready, fully controlled
productivity environment** — putting AI in the hands of everyone on your team.
See [Architecture](https://help.teable.ai/en/deploy/architecture) for how the
pieces fit together.

## ✨Features

### 🤖 AI-native

- **AI Chat** — ask, analyze, and operate on your data in natural language.
- **App Builder** — describe the app you need; an agent builds it in an isolated sandbox and deploys it to its own URL in one click.
- **AI automations** — react to record changes, schedules, and webhooks, with AI steps doing the reasoning.
- **AI field filling** — generate and enrich field values in bulk.

### 🍺 Everything you need, out of the box

Grid, Form, Kanban, Gallery, and Calendar views; formulas, field conversion,
filtering, grouping, sorting, and aggregation; comments, record history,
undo/redo, and real-time collaboration; attachments preview, batch editing,
import/export, search, validation, charts, plugins, SQL query — and millions
of rows without breaking a sweat.

More features land all the time — see the <a target="_blank" href="https://help.teable.ai/en/changelog">Changelog</a>.

## Deploy

Three ways to run Teable — pick by what you need (full comparison in the
[Deployment guide](https://help.teable.ai/en/deploy/choose)):

| | **Teable Cloud** | **Full-featured self-host** | **Standalone self-host** |
|---|---|---|---|
| Tables, collaboration, API, automation | ✅ | ✅ | ✅ |
| AI features (chat, agents) | ✅ | ✅ | ❌ |
| App Builder (build & deploy apps) | ✅ | ✅ | ❌ |
| Start here | [teable.ai](https://teable.ai) | [teableio/teable-deployment](https://github.com/teableio/teable-deployment) | [Docker guide](https://help.teable.ai/en/deploy/docker) |

Prefer not to deploy by hand? **Hand [teableio/teable-deployment](https://github.com/teableio/teable-deployment)
to your AI agent** (Claude Code, Codex, …) together with a domain, a DNS token,
and access to the target machine or cluster — it can take the deployment end
to end.

Already running standalone Teable? The runtime plane installs next to it and
your data stays in place: [migration guide](https://github.com/teableio/teable-deployment/blob/main/migration/2026-07-basic-to-full-featured.md).

## Development

#### 1. Initialize

```sh
# Enabling the Help Management Package Manager
corepack enable

# Install project dependencies
pnpm install
```

#### 2. Initialize Postgres

```sh
make switch-db-mode
```

#### 3. Custom Environment Variables（Optional）

```sh
cd apps/nextjs-app
cp .env.development .env.development.local
```

#### 4. Run Dev Server

you just need to start backend, it will start next server for frontend automatically, file change will be auto reload

```sh
cd apps/nestjs-backend
pnpm dev
```

## Why Teable?

**Software should fit the work — not the other way around.** Every team knows
the compromise: you have a concrete business need, you search for an app, and
it covers 70% of it. So you bend your process around the tool, or you file a
ticket and wait quarters for custom development. The work adapts to the
software, when it should be the software adapting to the work.

**AI only changes this if it reaches the real workflow.** A wave of AI tools
can now generate an app on demand — but each one is built in a vacuum: an
empty database, no knowledge of how your team actually operates, one more
island to integrate and maintain. The demo impresses; the workflow stays the
same.

**Teable puts the agent where the work already happens.** Your data, apps,
automations, permissions, and collaborators live here, on a real PostgreSQL —
and the AI operates all of it. Chat acts on live data. Automations reason
over records as they change. App Builder ships working systems wired to the
same database your team already uses — so what gets built is never another
silo, but a precise extension of the workflow it came from. AI lands in the
work seamlessly, and what it builds fits the business exactly.

**And it's an architecture an IT team can say yes to.** Self-hosting Teable
packages your own compute into an agent-ready platform for the whole team:
every AI session confined to an isolated sandbox, every app shipped as a
standard container, everything resting on PostgreSQL and HTTP APIs, with your
own models and keys, on your own infrastructure. Full AI capability, full
control — neither traded for the other.

The result is a different way of building: business systems shaped precisely
to your business, delivered in days instead of quarters, evolving as fast as
the work itself — by everyone on the team, not just the people who code.

# License

This repository is the Teable Community Edition: free for self-hosting under
the AGPL-3.0 license (packages under `packages/` are MIT). See
[./LICENSE](./LICENSE) for details.

The official image [`ghcr.io/teableio/teable`](https://github.com/teableio/teable/pkgs/container/teable)
ships the complete product: free to run, with paid plans unlocking AI features
and advanced enterprise capabilities **in place** — activate with a license
key, no image swap, no migration. See [pricing](https://teable.ai/pricing) and
[subscribe & activate](https://help.teable.ai/en/deploy/activate).
