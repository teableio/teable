Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# application/services Architecture Notes

## Responsibilities

- Implement application services that coordinate repositories, schema updates, and event publishing.
- Provide transactional orchestration around domain mutations and specs.
- Keep domain logic inside domain model/visitors; this layer only wires ports and supplies
  preloaded data for cross-table validation.

## Files

- `FieldCreationSideEffectService.ts` - Role: application service; Purpose: validate cross-table field
  dependencies (via visitors) and apply side effects after field creation.
- `FieldDeletionSideEffectService.ts` - Role: application service; Purpose: apply cross-table side
  effects after field deletion (e.g. remove symmetric link fields).
- `ForeignTableLoaderService.ts` - Role: application service; Purpose: load foreign tables once and
  validate missing references.
- `TableDeletionSideEffectService.ts` - Role: application service; Purpose: dispatch explicit
  `OnTeableTableDeleted` reactions in other tables before deleting a table, including link-to-text
  conversion and dependent metadata cleanup.
- `RecordBulkUpdateService.ts` - Role: application service; Purpose: prepare and execute selector
  or explicit-record batch updates, letting the domain model build specs/results while the service
  coordinates repository persistence, events, and undo/redo.
- `RecordReorderService.ts` - Role: application service; Purpose: apply batched row-order updates
  and build reorder events plus undo/redo payloads for callers that need native v2 reorder flows.
- `ImportTabularTableService.ts` - Role: application service; Purpose: shared create-table
  import workflow for parsed CSV/Excel named rows (schema, records, schema-operation lifecycle).
- `TableQueryService.ts` - Role: application service; Purpose: common table lookup operations
  (getById, getByIdInBase, exists) used across CommandHandlers and QueryHandlers.
- `TableUpdateFlow.ts` - Role: application service; Purpose: shared table update workflow (mutate +
  persist + publish), including mapping one persisted View query-default version touch to its
  filter/group/sort semantic events without consuming later mutation versions.
- `ViewPluginCreationService.ts` - Role: application service; Purpose: resolve external Plugin
  definitions and prepare/install Plugin View integrations around aggregate creation.
- `ViewManualSortService.ts` - Role: application service; Purpose: execute aggregate-declared
  row-order schema preparation and stream stable row-order updates through record repositories.
