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
- Record comment-count projections belong in `GetTableCommentCountHandler`: authorize the supplied
  loaded record IDs through the record-query plugin, then read counts through
  `ITableCommentQueryRepository`. Only row-scoped reads query the record data database, selecting
  authorized IDs without replaying view filters, search, grouping or pagination.
  Nest only converts transport inputs and dispatches the query. The PostgreSQL adapter reads comments
  from the metadata connection, not the record data/BYODB transaction. This read projection does not
  move comment writes or notification workflows into the Table aggregate.
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
- Template and base duplication are host workflows. Nest chooses source/target bases and spaces,
  permissions, audit scope, snapshot-pointer lifecycle, and edition resources (workflows, apps,
  routines, folders and base nodes). It supplies source `ITablePersistenceDTO` snapshots to
  `DuplicateBaseCommand`; the command remaps Table-owned field/view IDs and copies records. It does
  not own template IDs, billing, navigation nodes, or cross-context transactions. On a native
  command error, `DuplicateBaseErrorEvent.tableIdMap` identifies only destination tables whose
  native creation committed, so the host may compensate those exact tables without scanning or
  deleting existing target resources.
  A staged snapshot whose pointer swap fails is retired into Trash only after checking, under the
  snapshot swap lock, that no template points to it; a post-commit callback failure must not retire
  the published snapshot. Permanent base purge also removes edition-owned authority metadata.
- Field-operation plugins observe reciprocal Link schema changes as actual create/update/delete
  operations. The side-effect context names the table being changed in `table`, and retains the
  initiating table and operation in `target`; host adapters authorize that actual target.
  Plan and guard the reciprocal mutations before persistence, then run transaction-bound
  `beforePersist` and result-bearing `afterCommit`. Dependency cleanup caused by deleting a table
  remains a distinct operation, not a foreign field-management request.
- Every entry point that can create a reciprocal field must run that pipeline, including structure
  import. `ImportDotTeaStructureHandler` collects and guards the side effects it is about to apply
  before it persists anything, exactly as `CreateTablesHandler` does for table creation, instead of
  relying on `.tea` normalization to keep the target inside the archive.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: navigation and boundaries.
- `index.ts` - Role: package entry export; Purpose: public exports for domain/commands/queries/ports.
- `index.spec.ts` - Role: export regression test; Purpose: assert key exports exist.
