Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2/adapter-record-repository-postgres/src/computed Architecture Notes

## Responsibilities

- Resolve cross-table field dependencies for computed fields (formula/lookup/rollup/link).
- Build ordered update plans that respect field-level dependencies.
- Generate UPDATE...FROM statements using computed SELECT queries.
- Execute cascade updates with sync/hybrid strategies and outbox-backed async work.

## Examples

- `ComputedUpdatePlanner` groups same-table fields by dependency level so formula A updates before formula B.
- `UpdateFromSelectBuilder` uses `ComputedTableRecordQueryBuilder` to compute values, then persists them via UPDATE...FROM.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe computed update module scope.
- `FieldDependencyGraph.ts` - Role: dependency loader; Purpose: read reference/field metadata and build edges.
- `ComputedUpdatePlanner.ts` - Role: planner; Purpose: convert dependencies + changes into ordered update steps.
- `UpdateFromSelectBuilder.ts` - Role: SQL builder; Purpose: compile UPDATE...FROM statements from computed SELECTs.
- `ComputedFieldUpdater.ts` - Role: executor; Purpose: apply update plans and record propagation.
- `strategies/` - Role: update strategy; Purpose: sync/async execution policy.
- `outbox/` - Role: outbox store; Purpose: persist computed update tasks for background processing.
- `worker/ComputedUpdateWorker.ts` - Role: worker; Purpose: claim outbox tasks and run computed updates.
