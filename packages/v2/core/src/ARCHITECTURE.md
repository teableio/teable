Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2 core/src Architecture Notes

## Responsibilities

- Source root for @teable/v2-core; organizes commands/queries/domain/ports.
- Exposes the public API surface via `index.ts`.

## Subfolders

- `commands/` - Application commands and handlers (write side).
- `queries/` - Application queries and handlers (read side).
- `domain/` - Domain model (aggregates, value objects, specs, events).
- `ports/` - Ports plus default/memory implementations and mappers.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: navigation and boundaries.
- `index.ts` - Role: package entry export; Purpose: public exports for domain/commands/queries/ports.
- `index.spec.ts` - Role: export regression test; Purpose: assert key exports exist.
