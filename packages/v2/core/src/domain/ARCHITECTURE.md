Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain Architecture Notes

## Responsibilities

- Domain model core: aggregates, entities, value objects, specs, domain events.
- Depends only on TS/JS, neverthrow, zod, nanoid, ts-pattern.
- Repository-driven persistence lifecycle details belong behind ports/adapters; application code should
  observe aggregates and domain events, not drive adapter-private post-persist steps.
- Record materialization preserves the mutation-spec tree for persistence and deferred resolution,
  while applying immediately known cells in one pass; public records remain immutable.
- Sync and async record streams share field indexes and schemas for the iterator lifetime, but
  reevaluate dynamic defaults per record. Ordinary `createRecords` retains its per-call defaults.

## Subfolders

- `shared/` - Common domain base classes and shared value objects/spec framework.
- `base/` - Base domain concepts.
- `table/` - Table aggregate with fields/views/specs/events.
- `formula/` - Formula parsing/type inference helpers for domain use.
- `computed/` - Computed activity and outbox maintenance domain types.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe domain structure.

## Examples

- `packages/v2/core/src/domain/table/TableBuilder.spec.ts` - Aggregate build flow.
- `packages/v2/core/src/domain/shared/DomainBasics.spec.ts` - Core domain abstractions.
- `packages/v2/core/src/domain/table/specs/visitors/FieldUpdateSemanticsVisitor.ts` - Spec visitor that classifies field-update events for downstream realtime/presence handling.
- `packages/v2/core/src/domain/table/records/RecordSpecMaterializer.ts` - Applies one immutable record's cell specs in a single pass for creation, update and deferred-rewrite paths.
