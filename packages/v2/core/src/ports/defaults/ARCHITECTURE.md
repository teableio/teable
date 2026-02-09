Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# ports/defaults Architecture Notes

## Responsibilities

- No-op implementations for minimal runtime.
- Safe defaults when real adapters are not registered.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe default adapters.
- `NoopEventBus.ts` - Role: IEventBus default; Purpose: ignore event publishing.
- `NoopLogger.ts` - Role: ILogger default; Purpose: swallow log output.
- `NoopRealtimeEngine.ts` - Role: IRealtimeEngine default; Purpose: ignore realtime effects.
- `NoopPorts.spec.ts` - Role: default port tests; Purpose: verify no-op behavior.
- `NoopTableRepository.ts` - Role: ITableRepository default; Purpose: empty responses or not-found.
- `NoopTableRecordQueryRepository.ts` - Role: ITableRecordQueryRepository default; Purpose: empty record reads.
- `NoopTableRecordRepository.ts` - Role: ITableRecordRepository default; Purpose: ignore record writes.
- `NoopTableSchemaRepository.ts` - Role: ITableSchemaRepository default; Purpose: ignore schema writes.
- `NoopTracer.ts` - Role: ITracer default; Purpose: return noop span.
- `NoopUndoRedoStore.ts` - Role: IUndoRedoStore default; Purpose: ignore undo/redo logging.
- `NoopUnitOfWork.ts` - Role: IUnitOfWork default; Purpose: run callback without transaction.
- `index.spec.ts` - Role: export tests; Purpose: validate entry exports.
- `index.ts` - Role: module entry; Purpose: export default adapters.
