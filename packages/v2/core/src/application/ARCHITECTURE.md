Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# application Architecture Notes

## Responsibilities

- Application services that orchestrate domain behavior and coordinate ports.
- Own cross-aggregate workflows, transactions, and event publishing boundaries.
- Must not contain domain rules; delegate those to domain services/entities/visitors.

## Subfolders

- `projections/` - Projection types and handler decorator alias (EventHandler-based).
- `services/` - Application service implementations (orchestration only).

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe application layer scope.
- `services/FieldCreationSideEffectService.ts` - Role: application service; Purpose: apply cross-table side effects for field creation.
- `services/FieldDeletionSideEffectService.ts` - Role: application service; Purpose: apply cross-table side effects for field deletion.
- `services/DeleteByRangeApplicationService.ts` - Role: application service; Purpose: share range-based delete planning, persistence, undo/redo, and progress streaming for delete-by-range handlers.
- `services/ForeignTableLoaderService.ts` - Role: application service; Purpose: load foreign tables once and validate missing references.
- `services/RecordCreationService.ts` - Role: application service; Purpose: shared single-record creation workflow reused by multiple handlers.
- `services/RecordWritePluginRunner.ts` - Role: application service; Purpose: run typed record-write plugins across prepare/guard/beforePersist/afterCommit phases.
- `services/TableUpdateFlow.ts` - Role: application service; Purpose: transactionally apply table mutations and publish events.
