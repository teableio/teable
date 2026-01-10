Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table Architecture Notes

## Responsibilities

- Table aggregate, builder, value objects, and sort keys.
- Entry point for table fields/views/specs/events.
- Table update entry point via Table.update + TableMutator; mutate specs reuse table specs (e.g. TableByNameSpec) and mutate-only specs (e.g. TableAddFieldSpec, TableRemoveFieldSpec, TableUpdateViewColumnMetaSpec) but are passed separately from query specs.

## Subfolders

- `events/` - Table domain events.
- `fields/` - Field entities and field types.
- `methods/` - Extracted Table aggregate method implementations.
- `records/` - Table record entity and field-value models.
- `specs/` - Table specifications and builders.
- `views/` - View entities and view types.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe table aggregate structure.
- `DbTableName.ts` - Role: rehydrated value object; Purpose: persisted table name and schema split.
- `ForeignTable.ts` - Role: branded wrapper; Purpose: distinguish foreign table context.
- `IdValueObjects.spec.ts` - Role: ID tests; Purpose: verify table/field/view ID formats.
- `Table.spec.ts` - Role: aggregate tests; Purpose: verify Table behavior and invariants.
- `Table.ts` - Role: aggregate root; Purpose: manage fields/views and domain events.
- `TableBuilder.spec.ts` - Role: builder tests; Purpose: verify TableBuilder constraints.
- `TableBuilder.ts` - Role: builder; Purpose: fluent aggregate construction.
- `TableId.ts` - Role: value object; Purpose: TableId validation and generation.
- `TableName.ts` - Role: value object; Purpose: TableName validation and wrapping.
- `TableMutator.ts` - Role: update builder; Purpose: compose mutation specs and return immutable updates.
- `resolveFormulaFields.ts` - Role: domain helper; Purpose: resolve formula dependencies and result types.
- `resolveFormulaFields.spec.ts` - Role: domain tests; Purpose: validate formula resolution during build.
- `TableSortKey.spec.ts` - Role: sort key tests; Purpose: validate TableSortKey rules.
- `TableSortKey.ts` - Role: value object; Purpose: table sort key modeling.
- `methods/ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe extracted Table methods.
- `records/ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe record domain types.
- `records/RecordId.ts` - Role: value object; Purpose: record id validation and generation.
- `records/TableRecord.ts` - Role: entity; Purpose: represent table records.
- `records/TableRecordFields.ts` - Role: value object; Purpose: field-value pairs keyed by FieldId.
- `records/specs/ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe record condition specs.
- `fields/specs/ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe field specs.

## Examples

- `packages/v2/core/src/domain/table/TableBuilder.spec.ts` - Aggregate build flow.
- `packages/v2/core/src/domain/table/Table.spec.ts` - Invariants and events.
- `packages/v2/core/src/domain/table/Table.ts` - Update entry point and immutable rename flow.
