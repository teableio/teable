Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/shared/graph Architecture Notes

## Responsibilities

- Graph utilities for domain ordering and cycle detection.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe graph utilities.
- `topologicalSort.ts` - Role: helper; Purpose: stable topological ordering + cycle reporting.
- `topologicalSort.spec.ts` - Role: tests; Purpose: verify ordering and cycle detection.

## Examples

- `packages/v2/core/src/domain/table/Table.ts` - Field ordering by dependencies.
