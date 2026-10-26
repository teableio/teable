Declaration: If the folder I belong to changes, please update me.

# v2 adapter-db-postgres-pg Architecture Notes

## Responsibilities

- Provide the Kysely Postgres dialect backed by the `pg` driver.
- Re-export shared Postgres DB tokens/config schema and the UnitOfWork implementation from the shared adapter package.
- Expose DI helpers for registering the database into containers.
- Coordinate table schema writes through a dedicated advisory-lock pool that never competes with the shared meta/request pool.
- Provide opt-in, async-scoped cancellation for interactive reads without adding a SQL timeout or coupling the domain model to HTTP/ShareDB.

## Subfolders

- `src/di/` - DI registration helpers and shared tokens.

## Files

- `src/config.ts` - Re-exported Postgres connection config schema.
- `src/createDb.ts` - Kysely + `pg` dialect factory.
- `src/queryCancellation.ts` - Async-local abort scope and cancellation error identity; an undefined scope explicitly isolates background/transaction work.
- `src/cancellablePool.ts` - Kysely pool facade with per-checkout cancellation ownership; preserves raw pool instrumentation and external pool lifetime.
- `src/cancelRequest.ts` - Separate PostgreSQL CancelRequest connection to the original peer, retaining TLS verification and server identity.
- `src/unitOfWork.ts` - Re-exported transaction wrapper for v2 UnitOfWork.
- `src/schemaCoordination.ts` - Dedicated `pg.Pool` advisory-lock coordinator for table schema leases.
- `src/index.ts` - Package public exports.

## Schema coordination invariants

- A lease pins one dedicated-pool connection in an open transaction; `pg_advisory_xact_lock[_shared]` is taken per sorted table id. The lock cannot outlive the transaction, so a lost connection releases it server-side.
- Exhausting the coordination pool queues only coordination acquires. Business queries on the shared meta pool keep running, and `destroy()` rejects queued acquires instead of draining them after `pool.end()`.
- A checked-out client installs its own `error` listener (pg only listens while idle). A connection error destroys that client, marks the lease broken, and makes `release()` a no-op; release otherwise commits and returns the client, or rolls back and destroys it when the commit fails.
- Typecast record writes (updates and creates) hold a shared lease unless their preprocessing proves they add select options; only that side effect writes table metadata. An upgrade is release/reacquire: release the shared lease, acquire a new exclusive lease (an in-place shared-to-exclusive promotion deadlocks concurrent upgraders), reload table metadata, and recompute option side effects from the reloaded table instead of reusing shared-era results. The exclusive lease stays held until the record transaction commits so field deletion remains excluded.
- Creates probe the whole input batch before persisting. Ordinary creates (no typecast, or only existing options) read metadata once under `shared` and stay concurrent; a batch that would add select options releases `shared`, acquires `exclusive`, reloads, and rebuilds options from that metadata. Single-record probe/resolution errors stay `shared` because execution raises the same error before persistence and never filters the record; bulk errors widen to `exclusive` because row-limit plugins may truncate the failing rows after planning while the surviving rows still add options. Ordered creates prepare the view row-order column through `IRecordOrderColumnPreparer` before any lease, so `ADD COLUMN`, backfill, and `CREATE INDEX CONCURRENTLY` never run under coordination; they then follow the same shared-to-exclusive path. Only ordered updates keep the lease-free `none` plan.
- Update handlers delegate to their application services (`UpdateRecordApplicationService`, `UpdateRecordsApplicationService`). Create handlers own `withRecordWriteCoordination` inline (`CreateRecordHandler`, `CreateRecordsHandler`, `SubmitRecordHandler` plus their private execute methods). `RecordWriteSideEffectService.planCoordination` (single update), `RecordBulkUpdateService.planCoordination` (selector/explicit bulk update), and `RecordWriteSideEffectService.planCreateCoordination` (one record or the whole create batch) choose `shared` for metadata reads or `exclusive` for metadata writes, with an explicit reason and freshness requirement. The shared coordination helper owns leases and table loading: ordinary writes load once under shared coverage; upgrades release shared, acquire exclusive, and reload (two reads total); ordered creates add one pre-lease read for order-column preparation.

## Cancellation invariants

- A canceled waiter never starts SQL. A late checkout is consumed and released without affecting its current holder.
- An attempted cancellation quarantines its checkout until both the original statement and control connection settle, then retires it. Control connection closure is not proof that SQL stopped.
- Aborting an already completed scope cannot cancel work on a reused connection. Ordinary SQLSTATE 57014 errors retain their meaning unless this scope actively canceled the statement.
- Scope activation belongs to the host's explicit interactive-read entry points. Writes, exports, background work and existing write transactions do not inherit it. No global query deadline is introduced.
- The real PostgreSQL integration suite is `../adapter-table-repository-postgres/src/integration/postgres-query-cancellation.pg.integration.spec.ts`, enabled with `TEABLE_V2_RUN_PG_INTEGRATION=1`. It covers direct/TLS cancellation, delayed and failed control connections, checkout waits and parallel isolation.
- The companion `postgres-query-cancellation.pgbouncer.pg.integration.spec.ts` runs real PgBouncer session/transaction pooling, physical SQLSTATE 57014 cancellation, unrelated-reader isolation, backend reuse and a delayed CancelRequest in front of transaction pooling. Its image is digest-pinned; `TEABLE_V2_TEST_PGBOUNCER_IMAGE` permits testing another explicitly selected version. This fixture does not certify deployment-specific load balancing, TLS termination or BYODB proxies.
- The direct suite also exercises repeated active/queued cancellation bursts with pool sizes 5 and 20, and recovery with all slots quarantined behind delayed controls. It reports pool/TCP peaks, waiting counts, cancellation/recovery time and fresh-read latency. `pool.max` bounds pool membership, not instantaneous TCP sockets: retiring connections can overlap replacements until close events arrive. These local measurements are regression evidence, not production capacity limits.

## Host rollout boundary

HTTP disconnects and ShareDB subscription ownership feed the host query-bus scope. Internal Axios transports must preserve native cancellation errors rather than wrapping them as HTTP 500 errors; otherwise abandoned ShareDB replies become client error toasts.

Release in two separately deployable stages; do not ship the pending-unsubscribe SDK change in the server-support release.

1. **Server support:** deploy the adapter, HTTP cancellation and ShareDB ownership hooks while retaining the SDK's existing wait-for-ready unsubscribe behavior. Mixed old/new server replicas remain compatible with that client. Complete the server rollout and drain connections to old replicas before advancing.
2. **SDK activation:** only after every HTTP/WebSocket target has the hooks, deploy the record-only immediate pending unsubscribe change. Metadata subscriptions retain wait-for-ready behavior. Verify ordinary/shared Grid switching, stale replies, reconnect and live updates against this server fleet.

Rollback order is the reverse. Redeploy the stage-one SDK, invalidate stale asset delivery, then require active tabs to reload/close and drain their WebSocket sessions while keeping server hooks deployed. A WebSocket disconnect alone is insufficient: an open stage-two page can reconnect with its old JavaScript. Do not remove server hooks until stage-two clients can no longer connect. No new wire capability negotiation or runtime flag is provided.

Before activating a deployment topology, use an explicitly authorized isolated fixture through its actual AI/CN/BYODB endpoints. Record proxy/version, pooling mode, TLS termination and cancel routing; prove physical SQL cancellation while a lock remains held, isolation of concurrent work, delayed-cancel/backend-reuse safety, and pool/waiter recovery. Local direct PG and PgBouncer success cannot substitute for this gate. Do not run lock or cancellation-storm fixtures against customer data.

Physical suites run with `TEABLE_V2_RUN_PG_INTEGRATION=1` in the Formula PostgreSQL Plan Gate (PG16/17) and the Formula SQL PostgreSQL matrix (PG14/16/18). Both run remotely; the plan gate's commands live in the repository (`.github/scripts/ci-formula-plan-gate.sh`), so a pull request that changes them is checked by its own run even before a remote template sync. Ordinary unit/PGlite runs intentionally skip these Docker fixtures.
