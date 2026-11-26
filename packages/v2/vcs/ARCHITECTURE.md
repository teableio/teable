Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2/vcs Architecture Notes

## Responsibilities

- Own pure Base VCS domain logic: snapshots, 3-way structural & cell diffs, live `before` CAS evaluation (including deleted table, record, field, and view `before` snapshots and `before.version`), 3-way merges, conflict resolution, incremental & reverse replay, access-scope policy guards, and `v2|` `pg_snapshot` scoped cursor codecs.
- Define strict ports separating client workspace state/remote gateway (`ports/client.ts`) from server change-log persistence & host RBAC (`ports/server.ts`, `IVcsAccessPolicy`, `IBaseVcsLogRepository`), wired by DI symbols in `ports/tokens.ts`.
- Keep `@teable/v2-vcs` free of Kysely, `pg`, `@teable/v2-headless-runtime`, and `@nestjs/*` runtime dependencies so CLI, PGlite headless hosts, and NestJS share the exact domain & use-cases with zero circular workspace dependencies.

## Subpath Exports

- `.` (`src/index.ts`) - Domain functions, schemas, errors, access policy helpers (`accessPolicy.ts`), client/server ports, memory adapters, DI tokens.
- `./client` (`src/client/index.ts`) - Client sync use-cases (`CloneBaseVcsService`, `DiffBaseVcsService`, `GetBaseVcsStatusService`, `PullBaseVcsService`, `PushBaseVcsService`, `ResolveBaseVcsConflictsService`) + `registerV2VcsClientModule`, using streaming keyset clone (`--schema-only` & `/clone/records`), trigger-indexed O(delta) local diffs, and topological multi-batch push (`planPatchBatches`).
- `./server` (`src/server/index.ts`) - Server sync use-cases (`GetVcsHeadService`, `CloneVcsSnapshotService`, `ListVcsTableRecordsChunkService`, `ListVcsChangesService`, `PushVcsPatchService`, `EnableBaseVcsService`), `AllowAllVcsAccessPolicy`, `ReadOnlyVcsAccessPolicy`, `BaseVcsChangeLogProjection`, `tableToVcsSnapshot`, and `registerV2VcsServerModule`.
- `./engine` (`src/engine/index.ts`) - `V2EngineSyncAdapter` applying `IBaseVcsPatch` and chunked record hydration (`hydrateRecordChunk`, `captureTableRecordsChunk`, `flushComputed`, `skipCaptureSnapshot`) + `WorkingDirtyTracker` (PL/pgSQL row/junction/meta triggers in local PGlite for O(dirty) diffing).
- `./node` (`src/node/index.ts`) - 64-bucket FNV-1a hash-partitioned workspace baseline store (`FileVcsStateRepository`: `base.schema.json` + `base-records/<tableId>/b00..3f.json`) and HTTP headless local bridge.
- `./pglite` (`src/pglite/index.ts`) - Dependency-injected `PgliteLocalEngineAdapter` accepting a `createRuntime` factory with ref-counted `withSession` reuse over binary `.teable/vcs/pglite/` data dirs.

## Files

- `src/domain/diffSnapshots.ts` / `liveCas.ts` / `threeWayMerge.ts` / `chunkPatch.ts` / `accessPolicy.ts` - Snapshot diffing, live CAS normalization (`collectDeletedTableCasConflicts` + updated entity CAS), 3-way merge rules, topological batch planning & reciprocal two-way link baseline sync (`planPatchBatches`, `patchToBaselineMutationBatch`), and shared write/table-delete scope guards.
- `src/domain/cursor.ts` - Scoped `pg_snapshot` multi-page cursor codec (`v2|<scopeTag>|<maxSeq>|<pg_snapshot>[|<targetSnapshot>|<afterSeq>]`).
- `src/projections/BaseVcsChangeLogProjection.ts` & `extractDirtyKeys.ts` - `@SameTxProjectionHandler` capturing stored table/field/view/record changes, computed `RecordsBatchUpdated` updates, and symmetric link dirty keys inside the active domain transaction (fail-closed on repository error; v2-core write path prerequisite).
- `src/snapshot/tableToVcsSnapshot.ts` - Converts core `Table` aggregates + keyset cursor-paginated `auto-number` query records (`listTableRecordsChunkForVcs`) into `ITableVcsSnapshot` (excluding computed/readonly fields outside readable scope).
- `src/application/server/PushVcsPatchService.ts` - Orchestrates `IVcsAccessPolicy.assertCanApplyPatch` before `originPushId` deduplication, enforces `MAX_SINGLE_TX_PUSH_RECORD_OPS` (`TEABLE_VCS_MAX_SINGLE_TX_PUSH_OPS`, default `5,000`), and uses one atomic `withBatchTransaction` for physical and metadata locking, unmasked live CAS, `V2EngineSyncAdapter`, and commit finalization (enforcing split-DB `batch.cross_database_not_atomic` & `vcs.not_enabled`).
- Adding views with record-order values on an existing PostgreSQL table is limited to 1,000 backfilled order values per table, calculated as existing rows times new order columns. A read-compatible write fence guards this check after live CAS. Oversized patches are rejected atomically with `vcs.new_view_order_backfill_too_large`. Eligible patches acquire the DDL lock without waiting and commit order columns with the views and VCS receipt.
- Schema coordination holds a separate advisory lease across the push's write transaction attempts. Push and rollback transaction owners retry PostgreSQL serialization failures, deadlocks, and explicitly marked nonblocking lock contention. Exhaustion returns HTTP 503 `vcs.write_busy` with `error.details.retryable: true`. A stale before-value returns HTTP 409 `vcs.cas_conflict`.
- `src/application/server/EnableBaseVcsService.ts` - Explicit opt-in activation guarded by `IVcsAccessPolicy.assertCanEnableVcs`.
- `src/di/client.ts` & `src/di/server.ts` - Container registration (`registerV2VcsClientModule`, `registerV2VcsServerModule`).

## Examples

- `community/packages/v2/vcs/src/application/server/PushVcsPatchService.ts` - Server push transaction & CAS flow.
- `community/packages/v2/vcs/src/projections/BaseVcsChangeLogProjection.ts` - Same-transaction change-log projection.
