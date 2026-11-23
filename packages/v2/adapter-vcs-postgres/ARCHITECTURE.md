Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2/adapter-vcs-postgres Architecture Notes

## Responsibilities

- Implement `IBaseVcsLogRepository` (`PostgresBaseVcsLogRepository`) against PostgreSQL (and PGlite) using Kysely and `@teable/v2-core` Unit of Work transactions (`getPostgresTransaction` / `resolvePostgresDbOrTx`).
- Implement `v2|` native `pg_snapshot` visibility queries, `tableIds` scope tags, bounded 2-snapshot interval pagination (`hasMore`), and MVCC pre-enable quiesce barriers (`enabled_barrier_xid`, `pg_snapshot_xmin >= enabled_barrier_xid`).
- Execute all reads/writes strictly within existing tables migrated by `@teable/db-main-prisma`, `@teable/db-data-prisma`, and `@teable/v2-postgres-schema` (zero runtime DDL).

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe Postgres adapter boundaries.
- `src/index.ts` - Role: package entry; Purpose: export `PostgresBaseVcsLogRepository`, cursor helpers, `v2VcsPostgresTokens`, and `registerV2VcsPostgresAdapter`.
- `src/PostgresBaseVcsLogRepository.ts` - Role: repository implementation; Purpose: `getHead`, opt-in `true`-only cached `isEnabled`, barrier-enforced `enable`, same-tx `appendChanges` (`storeChangePayloads: false` default) with periodic `compactChanges`, `capturePullCursor`, `listChangesSince`, `lockPushMetadata`, `lockPushPhysicalTargets`, and `appendCommit`.
- `src/cursor.ts` - Role: cursor helpers; Purpose: `buildPullCursorFromSnapshot`, `isCursorBeforeRetention`, `computeScopeTag`, and `resolveChangesRetentionConfig`.
- `src/register.ts` - Role: DI binder; Purpose: register `PostgresBaseVcsLogRepository` as `v2VcsServerTokens.logRepository` and optional config as `v2VcsPostgresTokens.config`.
- `src/tokens.ts` - Role: DI tokens; Purpose: define `v2VcsPostgresTokens` and `IV2VcsPostgresAdapterConfig`.
- `src/PostgresBaseVcsLogRepository.db.spec.ts`, `BaseVcsChangeLogProjection.db.spec.ts`, `VcsServerUseCases.db.spec.ts` - Role: integration tests; Purpose: verify real-PG `pg_snapshot` pagination & barriers, same-tx projection/rollback + computed cascades, split-DB rejection, metadata-lock-before-read & deleted-table CAS, and server use-cases.

## Examples

- `community/packages/v2/adapter-vcs-postgres/src/PostgresBaseVcsLogRepository.ts` - Repository implementation using UoW transactions.
- `community/packages/v2/adapter-vcs-postgres/src/cursor.ts` - Native `pg_snapshot` pull cursor calculation.
