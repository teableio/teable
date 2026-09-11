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
- `ButtonClickWorkflowService.ts` - Role: Table Button-field workflow port; Purpose: optional automation after `ButtonClicked`. Not a host-hook template.
- `CommandBus.ts` - Role: port interface; Purpose: define ICommandBus + middleware contract.
- `DotTeaParser.ts` - Role: port interface; Purpose: parse .tea structure inputs.
- `EventBus.ts` - Role: port interface; Purpose: define IEventBus publish contract.
- `EventHandler.ts` - Role: handler registry; Purpose: map events to handlers.
- `ExecutionContext.ts` - Role: execution context model; Purpose: carry actor/transaction/tracer.
- `HandlerResolver.ts` - Role: container adapter; Purpose: resolve handlers by token.
- `Logger.ts` - Role: logging port; Purpose: abstract logging.
- `QueryBus.ts` - Role: port interface; Purpose: define IQueryBus + middleware contract.
- `RealtimeChange.ts` - Role: realtime model; Purpose: describe change operations.
- `RealtimeDocId.ts` - Role: realtime value object; Purpose: validate doc identifiers.
- `RealtimeEngine.ts` - Role: realtime port; Purpose: abstract realtime storage and fanout, including version-aware apply and delete operations for optimistic ShareDB sequencing.
- `RecordWritePlugin.ts` - Role: plugin port; Purpose: define typed record-write plugin hooks and operation contexts.
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
- `UndoRedoStore.ts` - Role: port interface; Purpose: store undo/redo log entries and cursor.
- `UnitOfWork.ts` - Role: transaction port; Purpose: wrap cross-repo transactions.
- `ViewPluginRepository.ts` - Role: Table plugin-view persistence; Purpose: install/read plugin views. Not a host-hook template.
- `tokens.spec.ts` - Role: tokens test; Purpose: validate token exports.
- `tokens.ts` - Role: DI tokens; Purpose: canonical Symbol IDs for core ports.

## Examples

- `packages/v2/core/src/ports/memory/MemoryCommandBus.ts` - Handler registry + resolver usage.
- `packages/v2/core/src/ports/memory/AsyncMemoryEventBus.ts` - Non-blocking event dispatch for fire-and-forget handlers.
