# @teable/v2-headless-runtime

Experimental headless facade over Teable v2. The host application owns UI,
identity, and authorization; this package exposes the table engine and its
persistence.

```ts
import { createHeadlessRuntime } from "@teable/v2-headless-runtime";

const runtime = await createHeadlessRuntime({
  backend: { kind: "pglite", dataDir: "./data" },
});

// runtime.commandBus / runtime.queryBus
await runtime.flushComputed();
await runtime.flushRealtime();
await runtime.close();
```

## Backends

- `pglite`: local directory, `memory://`, or browser IndexedDB (`idb://`).
  Bootstraps a local `public.users` row and undo-capture globals by default.
  `@teable/v2-headless-cli`'s `build:bun:pglite` binary embeds the PGlite wasm
  module and Postgres data bundle inside the executable, so no `pglite.wasm` or
  `pglite.data` files are needed beside it.
- `postgres`: external PostgreSQL, with optional split meta/data connections.
  Bootstrap is opt-in because the database may be shared.

Embedded assets are passed through the `pglite` backend option
(`IV2PostgresPgliteOptions`), which is forwarded to `PGlite.create`; the
`build:bun:pglite` binary supplies them from the executable:

```ts
backend: {
  kind: "pglite",
  dataDir: "./data",
  pglite: { wasmModule, fsBundle },
}
```

## Local PGlite mode

PGlite runs in-process; no PostgreSQL server and no Docker are needed.

- **Tests**: `dataDir: "memory://"` is ephemeral and per-process.

  ```ts
  const runtime = await createHeadlessRuntime({
    backend: { kind: "pglite", dataDir: "memory://" },
  });
  ```

- **Persistent local data**: point `TEABLE_PGLITE_DIR` at a directory when using
  the binary (`dataDir: "./data"` in the SDK).

  ```bash
  pnpm --filter @teable/v2-headless-cli build:bun:pglite
  TEABLE_PGLITE_DIR=./my-data PORT=3000 \
    ./community/packages/v2/headless-cli/dist/teable-headless-pglite
  ```

  Replacing the binary is safe: start the new binary with the same
  `TEABLE_PGLITE_DIR` and the data is reused.

Caveats:

- the data directory is a normal Postgres data directory, not a single file, and
  it is owned by one process at a time (PGlite is single-writer).
- no auth, users, permissions, UI, file/attachment endpoints, realtime
  transport, or multi-user collaboration. Those stay in the host.
- the PGlite binary is ~116 MB and observed RSS on macOS arm64 with an empty
  database was ~548 MB (~550 MB).

## Attachments

The runtime accepts an attachment store factory. `@teable/v2-local-attachments`
provides the Node/Bun filesystem implementation:

```ts
import { v2MetaDbTokens } from "@teable/v2-adapter-db-postgres-shared";
import { LocalAttachmentStore } from "@teable/v2-local-attachments";

const runtime = await createHeadlessRuntime({
  backend: { kind: "pglite", dataDir: "./data" },
  attachments: ({ container }) =>
    new LocalAttachmentStore({
      db: container.resolve(v2MetaDbTokens.db),
      rootDir: "./data/attachments",
      actorId: "usr_local",
    }),
});

const item = await runtime.attachments?.put({
  name: "receipt.pdf",
  mimetype: "application/pdf",
  data: bytes,
});
```

A browser or S3 implementation can satisfy the same `put`/`read` shape.

## Realtime

By default, the runtime registers `LocalRealtimeEngine`, an in-process engine with
record, table, field, and view projections. View and record mutations publish doc
and collection notifications.

```ts
runtime.realtime.subscribeDoc(docId, (snapshot) => {});
runtime.realtime.subscribeCollection(collection, (snapshots, removedIds) => {});
runtime.realtime.subscribeActivity((tableId) => {});
```

A host can instead supply any core `IRealtimeEngine`; the runtime registers the
same projections against that exact instance:

```ts
const runtime = await createHeadlessRuntime({ backend, realtime: customEngine });
// runtime.realtime has customEngine's concrete type
```

The host owns a supplied engine and must close any resources it owns. Runtime
`close()` only closes the persistence composition root. `flushRealtime()` waits
for deferred projection scheduling; it is not an acknowledgement that a custom
transport delivered or persisted an event. The default engine remains a
single-process change feed, not a collaboration server.

## HTTP and SDK

Use `@teable/v2-headless-http` for a Hono app and the typed contract client. The
host maps authenticated identity to an actor id; the runtime has no auth layer.

## Limits

The backend options forward `tableDataSafetyLimits`. For example:

```ts
backend: {
  kind: 'pglite',
  dataDir: './data',
  tableDataSafetyLimits: { tableSchema: { maxRowsPerTable: 10_000 } },
}
```

PGlite supports the standard limits and basic link/lookup/rollup. High-cardinality
link projections remain PostgreSQL-first; see the adapter e2e skips.

## What works

- base/table/field/view/record command and query buses
- record create/update with `domainWriteTransaction`
- formula, link, lookup, and rollup recomputation with `flushComputed()`
- in-process realtime snapshots with `flushRealtime()`, including view
  projections and collection notifications
- attachment bytes + metadata + record cell references + GC/thumbnail seam
- local table data-safety limits
- persistent PGlite reopen
- idempotent `close()`

## App bundles

`@teable/v2-app-bundle` builds and installs checksummed table-app zip bundles
(structure + seed + forward SQL migrations) on top of a runtime instance:

```ts
import { installAppBundle } from "@teable/v2-app-bundle";

const installed = await installAppBundle(runtime, bytes, { actorId: "usr_local" });
```

The installer runs on the same backend and requires a DotTea parser registered by
the host composition root as `v2CoreTokens.dotTeaParser`. Install only checks for
it and throws `install.dot_tea_parser_missing` when it is absent; it never
registers services itself.

## Not yet

Cross-process collaboration, S3 attachments, permissions/users/audit, and
`minRuntimeVersion` enforcement (the bundle field is metadata only) are outside
this slice.
