# Computed Update Architecture

> Declaration: If the folder I belong to changes, please update me, especially core domain concepts.

## Overview

This document describes the architecture for computed field updates (formula, lookup, rollup, link stored columns) when records are inserted, updated, or deleted.

## Design Principles

1. **Unified dependency model**: All field dependencies are represented as reference edges, not categorized by field type
2. **Trigger-based classification**: Distinguish between "value change" and "link relation change" at the trigger point, not in edge types
3. **Natural propagation**: Updates propagate through the dependency graph naturally; each updated field becomes a seed for the next wave
4. **Same-table batching**: All same-record dependencies within a table are computed together before propagating to other tables
5. **Self-referencing link support**: Links that reference the same table are handled correctly as cross-record dependencies
6. **Advisory locks for concurrency**: Each stage acquires transaction-scoped advisory locks on seed records (baseId+tableId+recordId), with table-level escalation when seed count exceeds `maxRecordLocks`. Locks are acquired in sorted order to minimize deadlocks.

---

## Key Concepts

### Edge Types

| Type           | Meaning                              | Example                                             |
| -------------- | ------------------------------------ | --------------------------------------------------- |
| `same_record`  | Dependency within the same record    | Formula referencing another field in the same table |
| `cross_record` | Dependency across records (via link) | Lookup/Rollup via link, or link stored column       |

**Key insight**: The distinction is NOT whether `fromTableId === toTableId`, but whether we need to traverse link relationships to find affected records. Self-referencing links (e.g., Employee → Manager) have `fromTableId === toTableId` but are still `cross_record`.

**Implementation detail**: In `loadReferenceEdges()`, when `fromTableId === toTableId` and `toFieldType` is `lookup/rollup/link`, we skip creating the edge because the correct `cross_record` edge (with `linkFieldId`) is created in `derivedEdges`. This avoids duplicate edges and ensures self-referencing links are correctly handled.

### Update Triggers

```typescript
type UpdateTrigger = {
  // Fields with value changes (non-link fields)
  valueChanges: FieldId[];

  // Link relation changes with detailed info
  linkChanges: LinkChange[];
};

type LinkChange = {
  fieldId: FieldId;
  changeType: "add" | "remove" | "replace" | "reorder";
  relationship: "oneOne" | "oneMany" | "manyOne" | "manyMany";
  isOneWay: boolean;
  symmetricFieldId?: FieldId; // For twoWay links
  symmetricTableId?: TableId;
  affectedForeignRecordIds: RecordId[]; // Records that gained a link
  removedForeignRecordIds: RecordId[]; // Records that lost a link
};
```

### Propagation Flow

```
1. Collect UpdateTrigger at repository layer (via LinkChangeCollectorVisitor)
2. For twoWay links, add symmetric link as extra seed
3. Find all same_record dependencies within the table
4. Execute updates in topological order
5. Collect cross_record dependencies from updated fields
6. Propagate dirty records to foreign tables via link relationships
7. Repeat from step 3 for each affected table
```

### Concurrency Locks

- Locks are acquired per stage using `pg_advisory_xact_lock`.
- Default scope is record-level (`baseId + tableId + recordId`), with table-level escalation when seed count exceeds `maxRecordLocks`.
- Configuration is provided via `computedUpdate.lockConfig` in the adapter registration.

---

## Component Responsibilities

### Structure

| Component                       | Responsibility                                                           |
| ------------------------------- | ------------------------------------------------------------------------ |
| `LinkChangeCollectorVisitor`    | Collect link changes, classify change type, determine affected records   |
| `types/UpdateTrigger.ts`        | Type definitions for `LinkChange`, `UpdateTrigger`, `BatchUpdateTrigger` |
| `FieldDependencyGraph`          | Load reference edges (2 types: `same_record`, `cross_record`)            |
| `ComputedUpdatePlanner`         | Plan update steps using edge model                                       |
| `ComputedFieldUpdater`          | Execute update steps and propagate dirty records                         |
| `PostgresTableRecordRepository` | Orchestrate, delegate to specialized components                          |

### Implementation Notes

The link change classification logic has been extracted from `PostgresTableRecordRepository.update()` to `LinkChangeCollectorVisitor`. The repository now uses the visitor pattern:

```typescript
// In PostgresTableRecordRepository.update()
const linkChangeVisitor = LinkChangeCollectorVisitor.create({
  recordId,
  existingLinkIds: existingLinks,
  newRawValue: rawValue,
});
const linkChangeResult = yield * linkField.accept(linkChangeVisitor);

if (linkChangeResult.hasChange) {
  mergeCollectedLinkChange(collectedLinkChanges, linkChangeResult, linkField.foreignTableId());
  // ...
}
```

---

## Dependency Edge Model

### Current Implementation

```typescript
// In FieldDependencyGraph.ts
type FieldDependencyEdgeKind = "same_record" | "cross_record";

type FieldDependencyEdgeSemantic =
  | "formula_ref"
  | "lookup_source"
  | "lookup_link"
  | "link_title"
  | "rollup_source";

type FieldDependencyEdge = {
  fromFieldId: FieldId; // Dependency source
  toFieldId: FieldId; // Dependent field
  fromTableId: TableId;
  toTableId: TableId;
  kind: FieldDependencyEdgeKind;
  linkFieldId?: FieldId; // For cross_record: which link to traverse
  semantic?: FieldDependencyEdgeSemantic; // Debugging metadata
};
```

### Edge Kind Semantics

| Kind           | Meaning                                              | When Used                                                                |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `same_record`  | Dependency within the same record, no link traversal | Formula referencing same-table field, lookup depending on its link field |
| `cross_record` | Dependency across records via link                   | Lookup/rollup source values, link title field                            |

### Edge Semantic Values

| Semantic        | Meaning                                                    |
| --------------- | ---------------------------------------------------------- |
| `formula_ref`   | Formula references another field                           |
| `lookup_source` | Lookup depends on source field value in foreign table      |
| `lookup_link`   | Lookup/rollup depends on which link field it uses          |
| `link_title`    | Link stored column depends on title field in foreign table |
| `rollup_source` | Rollup depends on aggregated field in foreign table        |

---

## Self-Referencing Link Handling

### Scenario

```
Employee table:
├── Name (text)
├── Manager (link to Employee, twoWay)
├── DirectReports (symmetric of Manager)
├── ManagerName (lookup via Manager → Name)
└── TeamSize (rollup via DirectReports, count)
```

### Case 1: Employee A's Name changes

Affected fields:

- All employees who have A as Manager → their `ManagerName` needs update

Edge: `Name → ManagerName` is `cross_record` (same table, but different records via Manager link)

### Case 2: Employee A's Manager changes from B to C

Affected fields:

- A's `ManagerName` (looking at new manager)
- B's `TeamSize` (lost a report)
- C's `TeamSize` (gained a report)
- B's `DirectReports` stored column
- C's `DirectReports` stored column

---

## Same-Table Optimization

### Current Behavior

Each step is planned and executed separately, even for same-table dependencies.

### Implemented: Same-Table Batch Identification

The planner now identifies **same-table batches** - groups of consecutive steps in the same table that only have `same_record` dependencies between them. This is the first step toward CTE optimization.

```typescript
// In ComputedUpdatePlanner.ts
type SameTableBatch = {
  tableId: TableId;
  steps: ReadonlyArray<UpdateStep>; // Steps ordered by level
  minLevel: number;
  maxLevel: number;
};

// Added to ComputedUpdatePlan
sameTableBatches: ReadonlyArray<SameTableBatch>;
```

#### Batch Identification Logic

1. Group steps by table
2. Sort steps by dependency level
3. Identify consecutive steps that:
   - Are in the same table
   - Have no `cross_record` dependencies (only `same_record`)
4. These form a batch that can potentially be optimized

### Future: CTE-Based Batch Execution

When multiple formulas in the same table depend on each other:

- Formula B = A + 1
- Formula C = B \* 2
- Formula D = C + 3

Instead of 3 separate UPDATE statements, use CTEs:

```sql
WITH
  level_0 AS (
    SELECT __id, (A + 1) as B_col FROM table_name
  ),
  level_1 AS (
    SELECT t.__id, (level_0.B_col * 2) as C_col
    FROM table_name t
    JOIN level_0 ON t.__id = level_0.__id
  ),
  level_2 AS (
    SELECT t.__id, (level_1.C_col + 3) as D_col
    FROM table_name t
    JOIN level_1 ON t.__id = level_1.__id
  )
UPDATE table_name u
SET
  B_col = level_0.B_col,
  C_col = level_1.C_col,
  D_col = level_2.D_col
FROM level_0, level_1, level_2
WHERE u.__id = level_0.__id
  AND u.__id = level_1.__id
  AND u.__id = level_2.__id
```

Benefits:

1. Each level sees computed values from previous levels
2. All updates in a single statement
3. Avoids multiple table scans

### Implementation Status

| Component                    | Status       | Notes                                          |
| ---------------------------- | ------------ | ---------------------------------------------- |
| `SameTableBatch` type        | ✅ Done      | Added to `ComputedUpdatePlanner.ts`            |
| `buildSameTableBatches()`    | ✅ Done      | Groups steps into optimizable batches          |
| `SameTableBatchQueryBuilder` | ✅ Created   | CTE query builder in `query-builder/computed/` |
| `executeSameTableBatch()`    | ✅ Framework | Batch execution with optimization check        |
| `canBatchOptimize()`         | ✅ Done      | Checks if batch contains only formula fields   |
| CTE execution                | 🔜 Pending   | Use `SameTableBatchQueryBuilder` for execution |

### Optimization Criteria

A batch can be CTE-optimized when:

1. All fields in the batch are **formula fields**
2. The batch has **more than 1 step** (otherwise no benefit)
3. No lookup/rollup/link fields (require lateral joins)

### Tracing

Batch information is included in traces:

```typescript
// Main span attributes
'computed.sameTableBatchCount': number;
'computed.optimizableBatchCount': number;

// Batch span attributes
'batch.tableId': string;
'batch.tableName': string;
'batch.stepCount': number;
'batch.minLevel': number;
'batch.maxLevel': number;
'batch.totalFieldCount': number;
'batch.canOptimize': boolean;
```

---

## Files

| File                                                      | Role                                               | Status  |
| --------------------------------------------------------- | -------------------------------------------------- | ------- |
| `UPDATE_ARCHITECTURE.md`                                  | This document                                      | Done    |
| `types/UpdateTrigger.ts`                                  | Type definitions for `LinkChange`, `UpdateTrigger` | Done    |
| `types/index.ts`                                          | Export types                                       | Done    |
| `../visitors/LinkChangeCollectorVisitor.ts`               | Collect link changes via visitor pattern           | Done    |
| `FieldDependencyGraph.ts`                                 | Edge loading with `same_record`/`cross_record`     | Done    |
| `ComputedUpdatePlanner.ts`                                | Update planning with batch identification          | Updated |
| `ComputedFieldUpdater.ts`                                 | Update execution with batch support                | Updated |
| `../query-builder/computed/SameTableBatchQueryBuilder.ts` | CTE-based batch query builder                      | New     |
| `../repository/PostgresTableRecordRepository.ts`          | Uses `LinkChangeCollectorVisitor`                  | Done    |

---

## Testing Strategy

### Required Test Scenarios

1. **Link type matrix**: oneWay/twoWay × oneOne/oneMany/manyOne/manyMany
2. **Self-referencing links**: Manager/DirectReports pattern
3. **Multi-level cascades**: A.field → B.lookup → C.formula
4. **Mixed triggers**: Value change + link change in same update
5. **Symmetric link updates**: Verify no infinite loops
6. **Outbox retry**: Simulate failures and recovery

---

## Observability

### Logging

All computed update operations log with:

- `computedRunId`: Unique run identifier
- `computedOriginRunIds`: Parent run IDs for async continuations
- `computedTaskId`: Outbox task ID (if async)

### Tracing

OpenTelemetry spans for computed updates. **All spans use `tracer.withSpan()` to ensure proper parent-child relationships** - this is critical for DB queries (via pg instrumentation) to be correctly nested under their logical parent spans.

```
teable.UpdateRecordHandler.handle
├── teable.TableQueryService.getById
├── teable.UpdateRecordHandler.updateRecord
├── teable.ComputedFieldUpdater.loadTables
│   └── pg.query:SELECT (table metadata) ← correctly nested
├── teable.ComputedFieldUpdater.resetDirtyTable
│   ├── pg.query:DROP (tmp_computed_dirty)
│   └── pg.query:CREATE (tmp_computed_dirty)
├── teable.ComputedFieldUpdater.seedDirtyRecords
│   └── pg.query:INSERT (seed records)
├── teable.ComputedFieldUpdater.propagateDirtyRecords
│   ├── teable.ComputedFieldUpdater.propagateEdge
│   │   └── pg.query:INSERT (propagation)
│   └── ... (more edges)
├── teable.ComputedFieldUpdater.collectDirtyStats
│   └── pg.query:SELECT (dirty counts)
└── teable.ComputedUpdateRun
    └── teable.ComputedFieldUpdater.level (level 0)
        ├── teable.ComputedFieldUpdater.step (step 0)
        │   └── pg.query:UPDATE (computed field update)
        └── ... (more steps in level)
```

**Important**: Without `withSpan()`, spans would only mark start/end times but DB queries would appear as direct children of the root handler span instead of their logical parent. The `runWithSpan` helper in `prepareDirtyState` ensures all operations properly propagate the span context.

#### Main Execute Span: `teable.ComputedFieldUpdater.execute`

| Attribute                                  | Description                                 |
| ------------------------------------------ | ------------------------------------------- |
| `computed.baseId`                          | Base ID                                     |
| `computed.seedTableId`                     | Initial table being updated                 |
| `computed.changeType`                      | Type of change (insert/update/delete)       |
| `computed.seedRecordCount`                 | Number of seed records                      |
| `computed.extraSeedGroupCount`             | Number of extra seed groups                 |
| `computed.stepCount`                       | Total steps in plan                         |
| `computed.edgeCount`                       | Total propagation edges                     |
| `computed.affectedTableCount`              | Number of affected tables                   |
| `computed.affectedFieldCount`              | Number of affected fields                   |
| `computed.affectedTableIds`                | Comma-separated table IDs                   |
| `computed.estimatedComplexity`             | Complexity estimate                         |
| `computed.minLevel` / `computed.maxLevel`  | Step level range                            |
| `computed.totalDirtyRecords`               | Total dirty records (set after preparation) |
| `computed.runId` / `computed.phase` / etc. | Run context attributes                      |

#### Level Span: `teable.ComputedFieldUpdater.level`

Steps are grouped by dependency level. Each level gets its own span:

| Attribute         | Description                        |
| ----------------- | ---------------------------------- |
| `level.index`     | Dependency level (0, 1, 2, ...)    |
| `level.stepCount` | Number of steps in this level      |
| `level.tableIds`  | Comma-separated table IDs in level |

#### Step Span: `teable.ComputedFieldUpdater.step`

Each step (table × level) gets its own span, as a child of the level span:

| Attribute                           | Description                          |
| ----------------------------------- | ------------------------------------ |
| `step.index`                        | Step index in plan                   |
| `step.level`                        | Dependency level                     |
| `step.tableId` / `step.tableName`   | Target table (ID and name)           |
| `step.fieldIds` / `step.fieldNames` | Fields being updated (IDs and names) |
| `step.fieldCount`                   | Number of fields                     |
| `step.dirtyRecordCount`             | Dirty records for this table         |
| `step.sql`                          | Generated SQL statement              |
| `step.parameterCount`               | Number of SQL parameters             |
| `step.position` / `step.pending`    | Progress tracking                    |

#### Edge Propagation Span: `teable.ComputedFieldUpdater.propagateEdge`

Each cross-record edge gets its own span:

| Attribute                                 | Description                                             |
| ----------------------------------------- | ------------------------------------------------------- |
| `edge.index` / `edge.order`               | Edge ordering                                           |
| `edge.fromTableId` / `edge.fromTableName` | Source table                                            |
| `edge.toTableId` / `edge.toTableName`     | Target table                                            |
| `edge.fromFieldId` / `edge.fromFieldName` | Source field                                            |
| `edge.toFieldId` / `edge.toFieldName`     | Target field                                            |
| `edge.linkFieldId` / `edge.linkFieldName` | Link field used for traversal                           |
| `edge.description`                        | Human-readable: `SourceTable.field → TargetTable.field` |
| `edge.sql`                                | Generated propagation SQL                               |

#### Same-Table Batch Span: `teable.ComputedFieldUpdater.sameTableBatch`

When executing a same-table batch (current fallback to step-by-step):

| Attribute               | Description                          |
| ----------------------- | ------------------------------------ |
| `batch.tableId`         | Table ID for the batch               |
| `batch.tableName`       | Table name                           |
| `batch.stepCount`       | Number of steps in batch             |
| `batch.minLevel`        | Minimum dependency level             |
| `batch.maxLevel`        | Maximum dependency level             |
| `batch.totalFieldCount` | Total fields across all steps        |
| `batch.canOptimize`     | Whether CTE optimization is possible |

### Retry & Dead Letter

- Max attempts: 8 (configurable)
- Backoff: Exponential (5s base, 5min max)
- Dead letter table: `computed_update_dead_letter`

### Dispatch Modes (Push vs Pull)

The `HybridWithOutboxStrategy` supports three dispatch modes for processing async computed updates:

| Mode       | Description                                      | Latency | Reliability | Use Case             |
| ---------- | ------------------------------------------------ | ------- | ----------- | -------------------- |
| `push`     | Inline dispatch after enqueue with delay         | Low     | Medium      | Development, testing |
| `external` | No inline dispatch, rely on external worker poll | Medium  | High        | Production (simple)  |
| `hybrid`   | Push with external worker as fallback            | Low     | High        | Production (optimal) |

#### Configuration

```typescript
// Push mode: fast but needs delay to avoid race condition
const pushConfig: HybridWithOutboxStrategyConfig = {
  dispatchMode: "push",
  dispatchDelayMs: 50, // Must be >= 50ms to allow transaction commit
  dispatchWorkerLimit: 50,
  dispatchWorkerId: "computed-inline",
};

// External mode: most reliable, recommended for production
const externalConfig: HybridWithOutboxStrategyConfig = {
  dispatchMode: "external",
  // No inline dispatch - external worker polls outbox
};

// Hybrid mode: best of both worlds
const hybridConfig: HybridWithOutboxStrategyConfig = {
  dispatchMode: "hybrid",
  dispatchDelayMs: 50,
  dispatchWorkerLimit: 50,
  dispatchWorkerId: "computed-inline",
  // External worker also polls as backup
};
```

#### External Worker Setup

For `external` or `hybrid` modes, use the built-in worker from `@teable/v2-container-node`:

```typescript
// Option 1: Programmatic API
import { createComputedUpdateWorker } from "@teable/v2-container-node";

const worker = await createComputedUpdateWorker({
  connectionString: process.env.DATABASE_URL,
  worker: {
    workerId: "computed-worker-1",
    batchSize: 50,
    pollIntervalMs: 1000,
  },
});

// Start polling
worker.start();

// Graceful shutdown
process.on("SIGTERM", () => worker.stop());
```

```typescript
// Option 2: CLI (for Docker/K8s)
import { runComputedWorkerCli } from "@teable/v2-container-node";

runComputedWorkerCli();
// Reads from: DATABASE_URL, WORKER_ID, WORKER_BATCH_SIZE, WORKER_POLL_INTERVAL_MS
```

```bash
# Option 3: Direct execution
DATABASE_URL=postgres://... node -e "require('@teable/v2-container-node').runComputedWorkerCli()"
```

#### Kubernetes Deployment Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: computed-update-worker
spec:
  replicas: 3 # Multiple workers for high availability
  template:
    spec:
      containers:
        - name: worker
          image: your-app-image
          command: ["node", "-e", "require('@teable/v2-container-node').runComputedWorkerCli()"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: url
            - name: WORKER_BATCH_SIZE
              value: "100"
            - name: WORKER_POLL_INTERVAL_MS
              value: "1000"
```

#### Race Condition Explanation

The `push` mode with `dispatchDelayMs: 0` has a race condition:

```
Timeline:
1. Request handler inserts outbox task (in transaction)
2. setTimeout(0) fires, drainOutbox() called
3. drainOutbox() opens NEW connection, queries outbox
4. NEW connection can't see uncommitted task!
5. drainOutbox() finds nothing, returns
6. Main transaction commits (too late)
7. Task remains pending until external worker polls
```

Solution: Use `dispatchDelayMs >= 50` or `dispatchMode: 'external'`

---

## Production Troubleshooting

### Playground Built-in Panel (Hybrid Mode)

Playground is the fastest place to build an **internal-only** panel for:

- Seeing whether a computed plan actually executed (and how far it got)
- Inspecting outbox / dead-letter payloads
- **Replaying dead-letter tasks with the original task id**

The panel should be driven by **v2-only context** (container + adapters), and the backend should emit **OTel logs + metrics** that the panel and alerts can rely on.

#### What the panel shows

- **Dead letters (highest priority)**
  - `taskId`, `runId`, `originRunIds`, `baseId`, `seedTableId`
  - `attempts/maxAttempts`, `failedAt`, `lastError`
  - `estimatedComplexity`, `syncMaxLevel`, `dirtyStats`
  - preview of `steps` (levels/tableIds/fieldIds) and `edges` count
- **Outbox pending/processing**
  - `taskId`, `status`, `attempts`, `nextRunAt`, `lockedAt`, `lockedBy`, `lastError`
  - "stuck" detection for `processing` tasks

#### DLQ replay semantics (original id)

Replay is a **move** from `computed_update_dead_letter` back to `computed_update_outbox` using the **same `id`**.

- Keep:
  - `id` (task id), `run_id`, `origin_run_ids`, `plan_hash`
  - `steps`, `edges`, `seed_record_ids`
  - `run_total_steps`, `run_completed_steps_before` (so progress stays interpretable)
- Reset:
  - `status = 'pending'`
  - `attempts = 0` (or keep, but recommend reset for clean retry accounting)
  - `next_run_at = now()`
  - `locked_at/locked_by = null`, `last_error = null`
  - `updated_at = now()`

If `seed_record_ids` is too large for inline storage (exceeds `seedInlineLimit`), spill into `computed_update_outbox_seed` and set `seed_record_ids = null`.

Pseudocode (DB transaction):

```ts
// ReplayDeadLetter(taskId)
// 1) SELECT row FROM computed_update_dead_letter WHERE id = $taskId FOR UPDATE
// 2) INSERT INTO computed_update_outbox (id, ..., status, attempts, next_run_at, ...) VALUES (...)
// 3) IF needSeedTable: INSERT computed_update_outbox_seed rows
// 4) DELETE FROM computed_update_dead_letter WHERE id = $taskId
```

#### OTel-only observability contract (logs + metrics)

The panel and alerting should not depend on Sentry.

- **Logs**: rely on structured logs already emitted (`computed:run:*`, `computed:outbox:*`, `computed:polling:*`). Ensure each log includes:

  - `computedRunId`, `computedTaskId`, `computedRunPhase`
  - `baseId`, `seedTableId`, `planHash`, `attempts`, `maxAttempts`
  - `estimatedComplexity`, `dirtyStats` (or summarized counts)

- **Metrics**: add a small set of stable instruments (names are examples; keep them consistent):
  - `teable_computed_outbox_enqueue_total{merged=bool, change_type}`
  - `teable_computed_outbox_claim_total`
  - `teable_computed_outbox_retry_scheduled_total`
  - `teable_computed_outbox_dead_letter_total`
  - `teable_computed_worker_task_duration_ms` (histogram)
  - `teable_computed_worker_task_failed_total`
  - `teable_computed_dlq_replay_total{result="ok"|"err"}`

#### Alerting rules (simple, strict)

- **DLQ non-empty** (priority-0): alert if `teable_computed_outbox_dead_letter_total` increases, or `computed_update_dead_letter` count > 0 (collector side query/receiver specific).
- **Stuck processing** (priority-1): alert when `computed_update_outbox.status='processing'` and `locked_at < now()-5m`.
- **Too complex** (priority-1): alert when a task is dead-lettered with `estimated_complexity` above a threshold, or when `dirty_stats.total` is above a threshold.

### OpenTelemetry / Jaeger / SigNoz

Use tracing to debug a single run, and logs/metrics to operate the system.

- Trace filters:
  - `computed.runId`, `computed.taskId`, `computed.phase`
- Log queries:
  - `message:"computed:outbox:dead_letter"` + `computedTaskId:<id>`
  - `message:"computed:outbox:retry_scheduled"` + `taskId:<id>`
- Metrics:
  - Use the counters above for dashboards and alerts

### Database Queries for Debugging

```sql
-- View pending outbox tasks
SELECT id, base_id, seed_table_id, status, attempts, next_run_at, last_error, created_at
FROM computed_update_outbox
WHERE status = 'pending'
ORDER BY created_at DESC
LIMIT 50;

-- View processing tasks (stuck?)
SELECT id, base_id, status, attempts, locked_at, locked_by
FROM computed_update_outbox
WHERE status = 'processing'
  AND locked_at < NOW() - INTERVAL '5 minutes';

-- View dead letter tasks
SELECT id, base_id, seed_table_id, attempts, last_error, failed_at
FROM computed_update_dead_letter
ORDER BY failed_at DESC
LIMIT 50;

-- Check dirty records for a specific table
SELECT table_id, COUNT(*) as record_count
FROM tmp_computed_dirty
GROUP BY table_id;
```

### Log Queries

Structured log analysis for debugging:

```
# Find all logs for a specific run
computedRunId:"curXXXXXXXXXXXXXXX"

# Find failed task logs
message:"computed:outbox:task_failed"

# Find retry scheduled logs
message:"computed:outbox:retry_scheduled"

# Find dead letter logs
message:"computed:outbox:dead_letter"
```

---

## Future Work

### CTE Batch Execution (In Progress)

The infrastructure for same-table batch optimization is in place:

- ✅ `SameTableBatch` type and `buildSameTableBatches()` identify optimizable batches
- ✅ `SameTableBatchQueryBuilder` generates CTE-based UPDATE queries
- ✅ `executeSameTableBatch()` framework with `canBatchOptimize()` check
- 🔜 Wire up `SameTableBatchQueryBuilder` in `executeSameTableBatch()` for actual CTE execution

When enabled, this will reduce multiple UPDATE statements to a single CTE-based UPDATE for formula chains in the same table.

### Comprehensive Test Suite

The testing strategy is defined above. Key test scenarios to implement:

1. **Link type matrix**: oneWay/twoWay × oneOne/oneMany/manyOne/manyMany
2. **Self-referencing links**: Manager/DirectReports pattern with cascading updates
3. **Multi-level cascades**: A.field → B.lookup → C.formula → D.link
4. **Mixed triggers**: Value change + link change in same update batch
5. **Symmetric link updates**: Verify no infinite loops
6. **Outbox retry**: Simulate failures and recovery

---

## Revision History

| Date       | Change                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| 2026-01-05 | Initial draft with TODO items                                                                                   |
| 2026-01-05 | Implemented edge type refactoring, created `LinkChangeCollectorVisitor`, updated `ComputedUpdatePlanner`        |
| 2026-01-05 | Enhanced tracing: added table/field names, dirty record counts, and comprehensive span attributes               |
| 2026-01-05 | Fixed self-referencing link handling: skip lookup/rollup/link edges in reference table when same table          |
| 2026-01-05 | Finalized documentation, moved remaining tasks to Future Work section                                           |
| 2026-01-05 | Improved span hierarchy: use `withSpan()` for proper parent-child, add level spans to group steps               |
| 2026-01-05 | Fixed span context propagation: all `prepareDirtyState` spans now use `runWithSpan` to properly nest DB queries |
| 2026-01-05 | Added same-table batch optimization: `SameTableBatch`, `buildSameTableBatches()`, `SameTableBatchQueryBuilder`  |
| 2026-01-05 | Fixed lookup-of-lookup double-encoding: check if foreign field is JSONB, use `::jsonb` cast + recursive flatten |
