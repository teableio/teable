Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# ports Architecture Notes

## Responsibilities

- Define external dependencies as ports (bus, repositories, unit of work, logging, tracing).
- Provide handler resolver and tracing decorator.
- Expose DI tokens for container registration.
- Keep logging contextual via child loggers and scoped metadata.
- Ports exist so Table-context work can persist, publish, or plugin-guard. A Noop default is
  allowed only when core already owns the concept (Button field, Plugin view). Do not add a Noop
  port whose only job is a host side-effect core does not interpret (folder, billing, sidebar).
  `ButtonClickWorkflowService` and `ViewPluginRepository` are Table-owned; they are not a template
  for host hooks (T3116 copied that shape for `ITableFolderRegistry` — rejected).

## Subfolders

- `defaults/` - No-op implementations for minimal runtime/testing.
- `memory/` - In-memory implementations for buses/repositories.
- `mappers/` - DTO <-> domain mapping contracts and defaults.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: explain port boundaries and implementations.
- `AttachmentUrlSignerService.ts` - Role: attachment presentation port; Purpose: sign preview and
  thumbnail URLs by file token, and give the public links of an attachment field with public
  links on (`AttachmentField.publicAccess`) by cell, since a public link belongs to the cell, not
  the file. A host without public files returns none.
- `ButtonClickWorkflowService.ts` - Table Button-field workflow port. Prepares the workflow once, exposes its record filter before the write, and runs the prepared workflow after commit.
- `CommandBus.ts` - Role: port interface; Purpose: define ICommandBus + middleware contract.
- `CsvParser.ts` - Role: lazy CSV source contract; Purpose: support bounded parsing without promising
  immediate headers for an ambiguous delimiter. The Papa adapter scores fixed lexical previews and
  replays ambiguous decoded prefixes from private Node files or browser IndexedDB. Detection can
  wait until EOF; disk/quota failures propagate and owner cleanup runs on every ordinary exit.
  A `url` source on a Node host is snapshotted to request-owned storage before any row is yielded,
  so a slow or interrupted network read never runs inside the write transaction. The snapshot is
  bounded by `TEABLE_CSV_SOURCE_MAX_BYTES` (default 512 MiB); local staging failures and source
  interruptions are separate error codes, and transport text is not exposed publicly. Streaming
  import writes in one transaction: a source interruption commits zero rows, the caller retries the
  whole file, and the host does not reattempt on its own.
- `DotTeaParser.ts` - Role: port interface; Purpose: parse .tea structure inputs.
- `DomainWriteTransaction.ts` - Role: transaction-owned event delivery; Purpose: commit data,
  same-tx projections, and journal together while supporting re-entrant batch write scopes
  (`withBatchTransaction`), deferred post-commit delivery (`status: 'deferred' | 'committed'`), and
  rejecting unsupported streaming inside batches. `executeStream` appends bounded batches, disables
  replay of one-shot input, and returns event summaries rather than record payloads. Post-commit
  finalization errors retain `committed: true`.
- `EventBus.ts` - Role: port interface; Purpose: define IEventBus publish contract.
- `EventHandler.ts` - Role: handler registry; Purpose: map events to handlers.
- `ExecutionContext.ts` - Role: execution context model; Purpose: carry actor, scoped
  transactions (`IUnitOfWorkTransaction` with optional `beginSavepoint()` callback isolation),
  re-entrant batch transaction scope (`IDomainBatchTransactionScope` with savepoint/rollback-only
  helpers `getBatchRollbackError` / `failBatchResultIfActive`), `sameTxProjection` metadata, and
  tracer.
- `HandlerResolver.ts` - Role: container adapter; Purpose: resolve handlers by token.
- `ImportEventSpool.ts` - Role: complete import-event snapshot storage outside the JS heap;
  Purpose: replay original values before transactional projections and after commit without accumulating rows. The Node adapter uses
  private temporary files; this is request-scoped storage, not a crash-recovery event queue.
- `Logger.ts` - Role: logging port; Purpose: abstract logging.
- `QueryBus.ts` - Role: port interface; Purpose: define IQueryBus + middleware contract.
- `RealtimeChange.ts` - Role: realtime model; Purpose: describe change operations.
- `RealtimeDocId.ts` - Role: realtime value object; Purpose: validate doc identifiers.
- `RealtimeEngine.ts` - Role: realtime port; Purpose: abstract realtime storage and fanout, including version-aware apply and delete operations for optimistic ShareDB sequencing.
- `RecordWritePlugin.ts` - Role: plugin port; Purpose: define typed record-write plugin hooks and operation contexts.
  `buttonClick` is distinct from `updateOne`: it persists a derived click count under record/field
  read authorization, including row scope and cell visibility. Ordinary edits and button resets
  retain update authorization.
- `RecordQueryPlugin.ts` - Role: plugin port; Purpose: read-side scope/guard hooks. `table` is `ITableReadModel`, not the mutating aggregate (T7092).
- `RepositoryQuery.ts` - Role: query options model; Purpose: unify sort/pagination.
- `TableRepository.ts` - Role: repository port; Purpose: table insert/find plus updateOne by identity with mutate specs.
- `TableRecordReadModel.ts` - Role: read model DTO; Purpose: lightweight record shape for queries.
- `TableRecordQueryRepository.ts` - Role: repository port; Purpose: read table records by table with optional condition specs, plus count/aggregate/calendar/collaborator capabilities on the same token.
- `TableRecordRepository.ts` - Role: repository port; Purpose: write table records with record units.
- `TableSchemaRepository.ts` - Role: schema port; Purpose: persist physical table schema.
- `TraceSpan.spec.ts` - Role: decorator tests; Purpose: verify span + error handling.
- `TraceSpan.ts` - Role: decorator; Purpose: wrap handlers with spans and Result errors.
- `Tracer.ts` - Role: tracing port; Purpose: abstract span creation and attributes.
- `UndoRedoStore.ts` - Role: grouped undo/redo log and cursor; Purpose: reserve metadata and
  read indexed entries without returning a composed interaction. New grouped recording input
  distinguishes `start` from `continue`; legacy read entries keep their shape. Progress and lease
  updates match the same reservation atomically; stale tokens cannot alter either. Keyv preserves
  unresolved old references, fails closed on ambiguous selected groups and retains durable private
  start-sequence evidence for new groups across optional-cache loss. Compatibility cache misses may
  scan bounded references one payload at a time; soft retention may keep an uncertain prefix beyond
  the window, but hard reference admission precedes history mutation. This is not a global Redis-byte
  guarantee and does not refresh stored payload expiry.
- `UnitOfWork.ts` - Role: transaction port; Purpose: wrap cross-repo transactions.
- `ViewPluginRepository.ts` - Role: Table plugin-view persistence; Purpose: install/read plugin views. Not a host-hook template.
- `tokens.spec.ts` - Role: tokens test; Purpose: validate token exports.
- `tokens.ts` - Role: DI tokens; Purpose: canonical Symbol IDs for core ports.

## Examples

- `packages/v2/core/src/ports/memory/MemoryCommandBus.ts` - Handler registry + resolver usage.
- `packages/v2/core/src/ports/memory/AsyncMemoryEventBus.ts` - Non-blocking event dispatch for fire-and-forget handlers.
