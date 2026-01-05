Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2/adapter-record-repository-postgres/src/computed Architecture Notes

## Responsibilities

- Resolve cross-table field dependencies for computed fields (formula/lookup/rollup/link).
- Build one-hop update plans (direct dependents only) and chain stages to cover deeper cascades.
- Generate UPDATE...FROM statements using computed SELECT queries.
- Execute cascade updates with sync/hybrid strategies and outbox-backed async work.
- Track computed update runs across sync/async phases (runId/originRunIds) for logs and traces.
- Apply change-impact filtering so value changes do not propagate through link-relation edges unless needed.
- Hybrid strategy defaults to same-table sync; cross-table steps enqueue to outbox and can be dispatched inline. Later stages are planned from updated computed fields + dirty records.

## Examples

- `ComputedUpdatePlanner` emits one-hop plans; deeper cascades are handled by the strategy/worker chaining stages.
- `FieldDependencyGraph` tags edges with kinds (`reference`, `lookup_by_value`, `lookup_by_link`, `link_stored_by_value`) so plans can filter propagation based on change type.
- `UpdateFromSelectBuilder` uses `ComputedTableRecordQueryBuilder` to compute values, then persists them via UPDATE...FROM.
- `HybridWithOutboxStrategy` syncs seed-table steps, enqueues remaining levels, and optionally triggers `ComputedUpdateWorker` after enqueue.
- `ComputedUpdateRun` tags every computed step with a shared runId so progress and pending counts can be logged across phases.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe computed update module scope.
- `FieldDependencyGraph.ts` - Role: dependency loader; Purpose: read reference/field metadata and build edges.
- `ComputedUpdatePlanner.ts` - Role: planner; Purpose: convert dependencies + changes into ordered update steps.
- `UpdateFromSelectBuilder.ts` - Role: SQL builder; Purpose: compile UPDATE...FROM statements from computed SELECTs.
- `ComputedFieldUpdater.ts` - Role: executor; Purpose: apply update plans and record propagation.
- `strategies/` - Role: update strategy; Purpose: sync/async execution policy.
- `outbox/` - Role: outbox store; Purpose: persist computed update tasks for background processing.
- `worker/ComputedUpdateWorker.ts` - Role: worker; Purpose: claim outbox tasks and run computed updates.
