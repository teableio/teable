Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# queries Architecture Notes

## Responsibilities

- Application read model (Query) definitions and handlers.
- Convert raw inputs to value objects/specs/sort/pagination.
- Query repositories and return Result.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe query layer scope.
- `computed-outbox/` - Computed-update outbox maintenance queries (overview, pauses, anomalies, queue jobs, task lineage).
- `GetTableByIdHandler.ts` - Role: query handler; Purpose: find a table by spec.
- `GetTableByIdQuery.ts` - Role: query DTO; Purpose: validate baseId/tableId and convert to value objects.
- `GetViewHandler.ts` - Role: query handler; Purpose: load a Table aggregate with one selected View child.
- `GetViewQuery.ts` - Role: query DTO; Purpose: validate Table/View IDs.
- `ListViewsHandler.ts` - Role: query handler; Purpose: project all active View children from a Table aggregate.
- `ListViewsQuery.ts` - Role: query DTO; Purpose: validate the owning Table ID.
- `ViewQueryProjection.ts` - Role: shared query projection; Purpose: map hydrated View children to the public read shape.
- `GetViewFilterLinkRecordsQuery.ts` - Role: query DTO; Purpose: validate the owning Table and View IDs.
- `GetViewFilterLinkRecordsHandler.ts` - Role: query handler; Purpose: load Table aggregates and
  read the linked records referenced by an owned View filter.
- `GetFieldFilterLinkRecordsQuery.ts` - Role: query DTO; Purpose: validate the owning Table and Field IDs.
- `GetFieldFilterLinkRecordsHandler.ts` - Role: query handler; Purpose: load the Field filter
  scope, collect Link references on the foreign Table, and read those linked records.
- `loadFilterLinkRecordGroups.ts` - Role: shared query loader; Purpose: hydrate filter-link
  record groups from foreign Table aggregates.
- `GetViewLinkRecordsQuery.ts` - Role: query DTO; Purpose: validate the owning Table, View, and Field IDs.
- `GetViewLinkRecordsHandler.ts` - Role: query handler; Purpose: partially load the Table aggregate
  and expose its validated cross-table Link Record query plan.
- `GetViewCollaboratorsQuery.ts` - Role: query DTO; Purpose: validate the owning Table, optional
  View/User Field, authorization fact, search, and pagination.
- `GetViewCollaboratorsHandler.ts` - Role: query handler; Purpose: execute the Table-owned
  collaborator plan through Table Record data and the independent collaborator directory.
- `GetRecordCollaboratorsQuery.ts` - Role: query DTO; Purpose: validate Table, User Field,
  search, and pagination for record collaborator reads.
- `GetRecordCollaboratorsHandler.ts` - Role: query handler; Purpose: resolve distinct User
  values on a User Field and look up public-safe directory rows including email.
- `GetViewSelectionCopyQuery.ts` - Role: query DTO; Purpose: validate shared clipboard range,
  projection, filter, order, group, search, collapse, and threshold inputs.
- `GetViewSelectionCopyHandler.ts` - Role: query handler; Purpose: load the authorized partial
  Table aggregate, execute its copy plan through the existing Table Record repository, and format
  the selected v2 Field values as clipboard text.
- `ListTableRecordsHandler.ts` - Role: query handler; Purpose: load records for a table.
- `ListTableRecordsQuery.ts` - Role: query DTO; Purpose: validate baseId/tableId and optional record filters.
- `CountTableRecordsHandler.ts` - Role: query handler; Purpose: count rows for a table without fetching records.
- `CountTableRecordsQuery.ts` - Role: query DTO; Purpose: validate table/view/filter/search/link inputs for row counts.
- `GetRecordStatusQuery.ts` - Role: query DTO; Purpose: validate Table/Record IDs plus the
  same view/filter/search/link inputs used by record counts.
- `GetRecordStatusHandler.ts` - Role: query handler; Purpose: compose record existence with a
  selected-id count to return deleted/visible status.
- `tableRecordQueryPlan.ts` - Role: shared query planner helpers; Purpose: resolve view filter, permission field lists, and projection for list and count reads.
- `tableRecordQueryConditionPlan.ts` - Role: shared link/selection planner; Purpose: build incoming-link candidate and selected specs for list and count reads.
- `ListTablesHandler.ts` - Role: query handler; Purpose: build specs and query with sort/pagination.
- `ListTablesQuery.spec.ts` - Role: query tests; Purpose: verify sort/pagination/validation logic.
- `ListTablesQuery.ts` - Role: query DTO; Purpose: build name filter, sort, and pagination.
- `QueryHandler.ts` - Role: handler interface + registry; Purpose: let the query bus resolve handlers.
- `RecordFilterDto.ts` - Role: DTO schema; Purpose: define filter group/condition inputs for record queries.
- `RecordFilterMapper.ts` - Role: mapper; Purpose: convert filter DTOs into record condition specs.

## Examples

- `packages/v2/core/src/queries/ListTablesQuery.spec.ts` - Query input conversion.
