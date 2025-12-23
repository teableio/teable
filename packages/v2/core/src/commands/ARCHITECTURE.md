Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# commands Architecture Notes

## Responsibilities

- Application write model (Command) definitions and handlers.
- Input validation via `zod.safeParse` and Result-only error flow.
- Coordinate domain creation/changes via repositories, buses, and unit of work.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe command layer scope.
- `CommandHandler.ts` - Role: handler interface + registry; Purpose: let the command bus resolve handlers.
- `CreateTableCommand.ts` - Role: command DTO + schema; Purpose: validate inputs and build TableBuilder inputs.
- `CreateTableHandler.ts` - Role: command handler; Purpose: build aggregate and persist/publish.
- `DeleteTableCommand.ts` - Role: command DTO + schema; Purpose: validate inputs for deletion.
- `DeleteTableHandler.ts` - Role: command handler; Purpose: delete table state/schema and publish events.
- `RenameTableCommand.ts` - Role: command DTO + schema; Purpose: validate inputs for renaming.
- `RenameTableHandler.ts` - Role: command handler; Purpose: persist table rename and publish events.

## Examples

- `packages/v2/test-node/src/commands/CreateTableHandler.spec.ts` - Command flow and port usage.
