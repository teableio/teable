Declaration: If the folder I belong to changes, please update me.

# v2 adapter-db-postgres-pg Architecture Notes

## Responsibilities

- Provide the Kysely Postgres dialect backed by the `pg` driver.
- Re-export shared Postgres DB tokens/config schema and the UnitOfWork implementation from the shared adapter package.
- Expose DI helpers for registering the database into containers.
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
- `src/index.ts` - Package public exports.

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

Physical suites run with `TEABLE_V2_RUN_PG_INTEGRATION=1` in the existing PR-side Formula PostgreSQL Plan Gate (PG16/17) and remote Formula SQL PostgreSQL matrix (PG14/16/18). Remote templates become active only after their develop-branch sync; the PR-side gate covers the pre-sync interval. Ordinary unit/PGlite runs intentionally skip these Docker fixtures.
