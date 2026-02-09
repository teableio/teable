Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# commands Architecture Notes

## Responsibilities

- Application write model (Command) definitions and handlers.
- Input validation via `zod.safeParse` and Result-only error flow.
- Coordinate domain creation/changes via repositories, buses, and unit of work.
- Rehydration-only fields (e.g. link meta, formula result types) are read-only; reject them in
  create/update inputs and only populate them via repository rehydration.

## Constraints

- Command handlers must not call other command handlers directly.
- Command handlers must not dispatch other commands via `ICommandBus`.
- Shared write workflows must be extracted into `application/services/**` and reused there
  (example: `services/RecordCreationService.ts` used by both `CreateRecordHandler` and
  `SubmitRecordHandler`).

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe command layer scope.
- `CommandHandler.ts` - Role: handler interface + registry; Purpose: let the command bus resolve handlers.
- `CreateTableCommand.ts` - Role: command DTO + schema; Purpose: validate inputs and build TableBuilder inputs.
- `CreateTableHandler.ts` - Role: command handler; Purpose: build aggregate and persist/publish.
- `CreateTablesCommand.ts` - Role: command DTO + schema; Purpose: validate batch table inputs.
- `CreateTablesHandler.ts` - Role: command handler; Purpose: create multiple tables in one unit of work.
- `CreateFieldCommand.ts` - Role: command DTO + schema; Purpose: validate inputs for adding a field.
- `CreateFieldHandler.ts` - Role: command handler; Purpose: update table meta/schema and publish events.
- `CreateRecordCommand.ts` - Role: command DTO + schema; Purpose: validate inputs for creating a record.
- `CreateRecordHandler.ts` - Role: command handler; Purpose: create record, persist, publish.
- `CreateRecordsCommand.ts` - Role: command DTO + schema; Purpose: validate inputs for batch record creation.
- `CreateRecordsHandler.ts` - Role: command handler; Purpose: create records, persist, publish.
- `CreateRecordsStreamCommand.ts` - Role: command DTO + schema; Purpose: validate streaming record inputs.
- `CreateRecordsStreamHandler.ts` - Role: command handler; Purpose: stream-create records, persist, publish.
- `DeleteFieldCommand.ts` - Role: command DTO + schema; Purpose: validate inputs for deleting a field.
- `DeleteFieldHandler.ts` - Role: command handler; Purpose: remove field metadata/schema and publish events.
- `FieldValidation.ts` - Role: helper; Purpose: decide notNull/unique support by field type.
- `DeleteTableCommand.ts` - Role: command DTO + schema; Purpose: validate inputs for deletion.
- `DeleteTableHandler.ts` - Role: command handler; Purpose: delete table state/schema and publish events.
- `ImportCsvCommand.ts` - Role: command DTO + schema; Purpose: validate CSV import inputs.
- `ImportCsvHandler.ts` - Role: command handler; Purpose: import CSV and create records.
- `ImportDotTeaStructureCommand.ts` - Role: command DTO + schema; Purpose: validate dottea structure imports.
- `ImportDotTeaStructureHandler.ts` - Role: command handler; Purpose: import dottea structure tables.
- `RenameTableCommand.ts` - Role: command DTO + schema; Purpose: validate inputs for renaming.
- `RenameTableHandler.ts` - Role: command handler; Purpose: persist table rename and publish events.
- `TableFieldSpecs.ts` - Role: parsing helpers; Purpose: shared field input schema + spec builders.
- `UpdateRecordCommand.ts` - Role: command DTO + schema; Purpose: validate inputs for updating a record.
- `UpdateRecordHandler.ts` - Role: command handler; Purpose: update record, persist, publish.

## Examples

- `packages/v2/test-node/src/commands/CreateTableHandler.spec.ts` - Command flow and port usage.
