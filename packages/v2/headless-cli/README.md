# @teable/v2-headless-cli

Bun/Node server entry for the headless runtime.

```bash
TEABLE_DATABASE_URL=postgres://... \
TEABLE_ATTACHMENTS_DIR=./data/attachments \
pnpm --filter @teable/v2-headless-cli build
node dist/cli.cjs
```

## Single-file binaries

Two Bun `--compile` flavors are provided:

| Script             | Output                        | Backend                                                    |
| ------------------ | ----------------------------- | ---------------------------------------------------------- |
| `build:bun`        | `dist/teable-headless`        | PostgreSQL via `TEABLE_DATABASE_URL` or meta/data URL pair |
| `build:bun:pglite` | `dist/teable-headless-pglite` | Embedded PGlite via `TEABLE_PGLITE_DIR`                    |

```bash
pnpm --filter @teable/v2-headless-cli build:bun
pnpm --filter @teable/v2-headless-cli build:bun:pglite
./community/packages/v2/headless-cli/dist/teable-headless --help
./community/packages/v2/headless-cli/dist/teable-headless-pglite --help
```

Approximate macOS arm64 sizes from a local build: `teable-headless` ~102 MB and
`teable-headless-pglite` ~116 MB. The PGlite flavor is larger because
`scripts/build-bun-pglite.mjs` embeds the PGlite wasm module and Postgres data
bundle into the executable; no `pglite.wasm`/`pglite.data` files are needed
beside it, and the data directory is created at `TEABLE_PGLITE_DIR` on first run.

The executable is a single file; local PGlite **data** is not. `TEABLE_PGLITE_DIR`
holds a normal Postgres data directory that one process owns at a time, and
replacing the binary with the same directory keeps the data. For an ephemeral
in-process database in tests, use the SDK with `dataDir: "memory://"`; no
PostgreSQL server or Docker is involved in either mode. See the
`@teable/v2-headless-runtime` README ("Local PGlite mode") for caveats: no auth,
users, permissions or UI, no file/attachment endpoints, and no remote realtime
transport (in-process `LocalRealtimeEngine` subscriptions exist only inside the
runtime and have no subscription auth). The PGlite binary is ~116 MB with
observed RSS ~548 MB.

## Why tsdown before Bun

Bun can bundle and compile the CLI, but v2 uses legacy TypeScript decorators
(`experimentalDecorators` plus parameter decorators for DI). Bun applies TC39
decorator semantics to imported workspace TypeScript, which crashes at runtime
with `descriptor.value` undefined. Both flavors therefore run one tsdown bundle
first (`tsdown.bundle.config.ts` or `tsdown.bundle.pglite.config.ts`) to compile
the decorators, then Bun compiles that single CJS file. This is a decorator
precompile step, not a monorepo build: dependency packages still have to be built
(or resolved through their `@teable/source` export) beforehand.

## Environment

See `--help`. `TEABLE_PGLITE_DIR` selects local PGlite; otherwise
`TEABLE_DATABASE_URL` or the meta/data URL pair selects PostgreSQL. The PGlite
flavor still honors the PostgreSQL variables: when `TEABLE_PGLITE_DIR` is unset
it falls back to the same environment resolution as the PostgreSQL flavor. The
host owns authentication; the CLI only maps an actor header to the execution
context.
