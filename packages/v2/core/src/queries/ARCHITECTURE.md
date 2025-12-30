Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# queries Architecture Notes

## Responsibilities

- Application read model (Query) definitions and handlers.
- Convert raw inputs to value objects/specs/sort/pagination.
- Query repositories and return Result.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe query layer scope.
- `GetTableByIdHandler.ts` - Role: query handler; Purpose: find a table by spec.
- `GetTableByIdQuery.ts` - Role: query DTO; Purpose: validate baseId/tableId and convert to value objects.
- `ListTableRecordsHandler.ts` - Role: query handler; Purpose: load records for a table.
- `ListTableRecordsQuery.ts` - Role: query DTO; Purpose: validate baseId/tableId and optional record filters.
- `ListTablesHandler.ts` - Role: query handler; Purpose: build specs and query with sort/pagination.
- `ListTablesQuery.spec.ts` - Role: query tests; Purpose: verify sort/pagination/validation logic.
- `ListTablesQuery.ts` - Role: query DTO; Purpose: build name filter, sort, and pagination.
- `QueryHandler.ts` - Role: handler interface + registry; Purpose: let the query bus resolve handlers.
- `RecordFilterDto.ts` - Role: DTO schema; Purpose: define filter group/condition inputs for record queries.
- `RecordFilterMapper.ts` - Role: mapper; Purpose: convert filter DTOs into record condition specs.

## Examples

- `packages/v2/core/src/queries/ListTablesQuery.spec.ts` - Query input conversion.
