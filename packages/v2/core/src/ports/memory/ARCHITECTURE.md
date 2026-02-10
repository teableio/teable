Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# ports/memory Architecture Notes

## Responsibilities

- In-memory implementations for buses/repositories.
- Useful for tests and minimal runtime scenarios.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: explain memory adapters.
- `AsyncMemoryEventBus.ts` - Role: IEventBus async impl; Purpose: enqueue events and dispatch handlers in background.
- `MemoryCommandBus.ts` - Role: ICommandBus memory impl; Purpose: resolve handler and execute command.
- `MemoryEventBus.ts` - Role: IEventBus memory impl; Purpose: invoke registered event handlers.
- `MemoryPorts.spec.ts` - Role: memory port tests; Purpose: validate bus/repository behavior.
- `MemoryQueryBus.ts` - Role: IQueryBus memory impl; Purpose: resolve handler and execute query.
- `MemoryTableRepository.ts` - Role: ITableRepository memory impl; Purpose: array storage + spec filter/sort/paginate + updateOne by id.
- `MemoryUndoRedoStore.ts` - Role: IUndoRedoStore memory impl; Purpose: log + cursor for undo/redo in tests.
- `index.spec.ts` - Role: export tests; Purpose: validate entry exports.
- `index.ts` - Role: module entry; Purpose: export memory adapters.
