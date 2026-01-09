Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2/debug-data Architecture Notes

## Responsibilities

- Provide read-only debug access to base/table/field metadata.
- Build field relationship reports using dependency graph data.
- Expose a DI registration helper and a Node client factory (container-backed).

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe the debug package scope.
- `src/types.ts` - Role: DTOs; Purpose: describe debug data payloads and report shapes.
- `src/ports/DebugMetaStore.ts` - Role: port; Purpose: abstract metadata read access.
- `src/ports/FieldRelationGraph.ts` - Role: port; Purpose: abstract dependency graph access.
- `src/adapters/postgres/PostgresDebugMetaStore.ts` - Role: adapter; Purpose: read metadata from Postgres (Kysely).
- `src/adapters/postgres/PostgresFieldRelationGraph.ts` - Role: adapter; Purpose: read dependency graph via Postgres adapter.
- `src/service/DebugDataService.ts` - Role: service; Purpose: provide debug queries and relation reports.
- `src/di/register.ts` - Role: DI wiring; Purpose: register debug services and adapters.
- `src/index.ts` - Role: package entry; Purpose: export public types and APIs.

## Examples

- `packages/v2/debug-data/src/service/DebugDataService.ts` - Debug reads and relation report logic.
- `packages/v2/debug-data/src/adapters/postgres/PostgresDebugMetaStore.ts` - Metadata queries for table_meta/field.
