# Self-hosting Teable with Docker

Two ways to run Teable yourself — pick by what you need:

| | **Standalone (this directory)** | **Full-featured self-host** |
|---|---|---|
| Tables, collaboration, API, automation | ✅ | ✅ |
| AI features (chat, agents) | ❌ | ✅ |
| App Builder (build & deploy apps) | ❌ | ✅ |
| Sandboxes / previews | ❌ | ✅ |
| Footprint | one machine, app + PostgreSQL | one machine (Docker) or a Kubernetes cluster |
| Where | [`examples/standalone/`](examples/standalone/) | [teableio/teable-deployment](https://github.com/teableio/teable-deployment) |

Just want to try Teable without deploying anything? Use
[teable.ai](https://teable.ai).

Already running standalone and want the AI features later? Your data stays in
place — the full-featured deployment attaches a runtime plane next to your
existing app. See the
[upgrade guide](https://github.com/teableio/teable-deployment/blob/main/migration/2026-07-basic-to-full-featured.md).
