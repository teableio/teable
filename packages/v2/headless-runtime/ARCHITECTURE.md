Declaration: If the folder I belong to changes, please update me, especially the backend and lifecycle contracts.

# v2/headless-runtime Architecture Notes

## Responsibilities

- Provide a headless facade over the existing v2 composition roots.
- Select a persistence backend: PGlite or PostgreSQL.
- Bootstrap a local actor and undo-capture globals for PGlite.
- Expose command/query buses, computed draining, realtime, attachments, and lifecycle.
- Stay free of UI, authentication, billing, and cloud control-plane concerns.

## Boundaries

- `@teable/v2-core` remains the Table bounded context. Host concepts (folders,
  base nodes, billing, sidebar order) do not enter core through this package.
- The host owns identity, authorization, audit, and presentation.
- Backend-specific wiring stays in `container-browser` / `container-node`; this
  package only composes them.

## Backends

| Backend    | Composition root    | Persistence                           |
| ---------- | ------------------- | ------------------------------------- |
| `pglite`   | `container-browser` | PGlite directory, memory, or `idb://` |
| `postgres` | `container-node`    | External PostgreSQL                   |

`pglite` is suitable for local runtimes and tests; its data is a directory owned
by a single writer. `postgres` is the more complete path because it includes the
full write, transaction, and outbox wiring.

## Local bootstrap

PGlite bootstraps by default:

- creates `public.users` and inserts one actor row;
- installs the undo-capture globals required by record mutations.

PostgreSQL bootstrap is opt-in (`bootstrap: true`) because the data database may
be shared with other applications.

## Computed updates

Writes that change formula, lookup, or rollup values enqueue computed work:

```ts
const report = await runtime.flushComputed();
```

This is a bounded work attempt, not a global idle barrier. The report includes
live `pending`, `scheduled`, `processing`, `paused`, `deadLetter`, `nextRunAt`
and `drained`; `pending > 0` is never idle and dead letters keep `drained: false`.
`close()` rejects new work, performs bounded computed and durable flush attempts, and throws
`runtime.close_incomplete` after disposal when pending or dead-letter work remains. A settlement
timeout does not dispose the runtime, so the host may retry close.

## Realtime

`LocalRealtimeEngine` is the default core `IRealtimeEngine` adapter and keeps
in-process document snapshots plus doc/collection/activity listeners. A host may
inject another `IRealtimeEngine`; the runtime registers the same record, table,
field, and view projections exactly once against the selected engine.

The host owns an injected engine's lifecycle. Runtime `close()` does not dispose
it. For `LocalRealtimeEngine`, `flushRealtime()` settles both the event bus and
tracked direct projection tasks before reporting failures. A custom transport
returns `unsupported` without a host acknowledgement. `flushBackground()` polls
the durable domain-event worker when registered, settles work it scheduled, and
reports durable counts. PGlite uses an in-memory projection journal (no durable
worker), so fresh writes create no orphan rows; pre-existing rows without a
worker surface as `worker_unavailable`.

## Attachments

The host supplies an attachment store factory; the runtime does not choose
filesystem, S3, or browser storage. `@teable/v2-local-attachments` is the
Node/Bun filesystem implementation. It writes content-addressed files plus the
`attachments` metadata row; the record adapter writes the `attachments_table`
cell references when the attachment field is persisted.

## Limits

`tableDataSafetyLimits` is forwarded to the backend composition root. PGlite
supports the standard limits and basic link/lookup/rollup; high-cardinality link
projections remain PostgreSQL-first.

## Files

- `src/index.ts` - Facade, backend selection, bootstrap, computed draining,
  attachment seam, lifecycle.
- `src/realtime.ts` - In-process realtime engine and subscriptions.
- `src/registerRealtime.ts` - Selected engine and record/table/field/view projection registration.
- `src/index.spec.ts` - PGlite coverage for base creation, formula update,
  link/lookup/rollup, persistent reopen, attachments, realtime, and limits.
- `src/realtime.spec.ts` - View projection and collection-notification coverage.

## Known limitations

- Persistent Node/Bun PGlite is protected by a fail-fast cross-process directory
  lock; `memory://` and browser `idb://` do not use that filesystem lock.
- Realtime is single-process; collaboration requires a server.
- The local attachment store is Node/Bun-only; thumbnails require a host-provided
  thumbnailer. GC is explicit, not a background scheduler.
- `@teable/v2-app-bundle` composes on top of this package; app-bundle
  `minRuntimeVersion` is metadata only and is not enforced here.
