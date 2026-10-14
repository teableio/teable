# SSA companion workspace

Standalone pnpm workspace for the SSA services that sit next to the Teable core.
It is intentionally **separate** from the Teable monorepo workspace (its own lockfile)
so upstream syncs stay conflict-free and CI stays fast.

```
services/notify   # Gmail digests + event alerts + in-app notify bridge   (M3)
services/ai       # OpenAI-compatible assistant backend (chat + tools)    (M4)
voice/            # Pipecat voice agent (Python, uv-managed)              (M5)
```

## Quick start

```bash
cd ssa
pnpm install
cp .env.example .env        # fill in tokens (never commit .env)
pnpm -r dev                 # starts every service that exists
```

Service-specific documentation lives in each folder's `README.md` and in
`docs/ssa/` (architecture, environment catalogue, roadmap, deployment).
