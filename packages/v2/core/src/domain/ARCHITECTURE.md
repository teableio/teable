Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain Architecture Notes

## Responsibilities

- Domain model core: aggregates, entities, value objects, specs, domain events.
- Depends only on TS/JS, neverthrow, zod, nanoid, ts-pattern.

## Subfolders

- `shared/` - Common domain base classes and shared value objects/spec framework.
- `base/` - Base domain concepts.
- `table/` - Table aggregate with fields/views/specs/events.
- `formula/` - Formula parsing/type inference helpers for domain use.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe domain structure.

## Examples

- `packages/v2/core/src/domain/table/TableBuilder.spec.ts` - Aggregate build flow.
- `packages/v2/core/src/domain/shared/DomainBasics.spec.ts` - Core domain abstractions.
