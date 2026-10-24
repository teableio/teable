Declaration: If the folder I belong to changes, please update me.

# v2/headless-cli Architecture Notes

## Responsibilities

- Resolve a backend from environment variables.
- Start the headless runtime, optional local attachment store, and Hono HTTP app.
- Provide Bun `--compile` entries for a single-file PostgreSQL server and a
  single-file embedded-PGlite server.

## Boundaries

- Authentication stays in the host/actor header; this package has no auth.
- The PostgreSQL flavor does not embed PGlite assets and reads PGlite only
  through `TEABLE_PGLITE_DIR` (no wasm/data beside the binary). The PGlite flavor
  embeds the wasm module and Postgres data bundle and injects them as
  `PGlite.create` options.
- No domain logic.

## Files

- `src/index.ts` - backend resolution and `startHeadlessServer`.
- `src/cli.ts` - process entry, signals, help.
- `src/cli-main.ts` - shared argument/env handling with an injectable backend
  resolver.
- `src/embedded-pglite.ts` - embedded-asset backend resolution for the PGlite
  flavor.
- `src/embedded-pglite-assets.ts` - reads `pglite.wasm`/`pglite.data` from
  `Bun.embeddedFiles` and turns them into `PGlite.create` options.
- `src/embedded-pglite-cli.ts` - entry for the PGlite bundle.
- `src/index.spec.ts`, `src/embedded-pglite.spec.ts` - environment and backend
  resolution tests.
- `scripts/build-bun-pglite.mjs` - locates `pglite.wasm`/`pglite.data` in the
  installed PGlite package, passes them as `--asset` to
  `bun build --compile`, and writes `dist/teable-headless-pglite`.

## Binaries

Both scripts run one tsdown bundle (decorator precompile), then Bun:

- `build:bun` (`tsdown.bundle.config.ts`) compiles `dist/bundle/cli.cjs` into
  `dist/teable-headless`; the backend comes from the environment at runtime.
- `build:bun:pglite` (`tsdown.bundle.pglite.config.ts`) compiles
  `dist/bundle-pglite/embedded-pglite-cli.cjs`, with the PGlite wasm and data
  bundle attached by `scripts/build-bun-pglite.mjs`, into
  `dist/teable-headless-pglite`.

The compiled binaries bundle the v2 CJS dists and require the dependency
packages to have been built first (`pnpm build` does this). tsdown here exists
only because Bun miscompiles legacy decorators; it is not a monorepo build.
