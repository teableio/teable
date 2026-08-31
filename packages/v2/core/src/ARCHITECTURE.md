Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2 core/src Architecture Notes

## Responsibilities

- Source root for @teable/v2-core; organizes commands/queries/domain/ports.
- Exposes the public API surface via `index.ts`.
- Hosts application-level undo/redo services and commands wired through ports.

## Subfolders

- `commands/` - Application commands and handlers (write side).
- `queries/` - Application queries and handlers (read side).
- `application/` - Application services that orchestrate domain behavior and ports.
- `domain/` - Domain model (aggregates, value objects, specs, events).
- `ports/` - Ports plus default/memory implementations and mappers.

## Layering Rules

- Command handlers may orchestrate ports and application services, but must not call other command
  handlers or re-dispatch commands through `ICommandBus`.
- Shared write behavior belongs in `application/services/` and is reused by handlers.
- Repository-specific post-persist work (for example schema refresh, backfill replay, or
  repository-originated action-trigger collection) stays inside the repository `create/update/delete`
  method. Application flows may only consume the returned aggregate and its domain events.
- v2-core is the Table bounded context (table, field, view, record, formula). Host navigation such
  as folder / base-node (`folderId`, `parentId`, sidebar order) does not belong on commands or ports,
  even as an opaque id with a Noop adapter. Nest attaches after the command returns, e.g.
  `ImportOpenApiV2Service` calling `BaseNodeService.attachResourceToParent` once the table is ready.
  Example of the wrong seam: `community/apps/nestjs-backend/src/features/import/open-api/import-open-api-v2.service.ts`
  (host) vs a v2-core `ITableFolderRegistry` port (do not add).
  `IButtonClickWorkflowService` and `IViewPluginRepository` are Table-owned optional adapters
  (Button field / Plugin view), not a template for host Noop ports.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: navigation and boundaries.
- `index.ts` - Role: package entry export; Purpose: public exports for domain/commands/queries/ports.
- `index.spec.ts` - Role: export regression test; Purpose: assert key exports exist.
