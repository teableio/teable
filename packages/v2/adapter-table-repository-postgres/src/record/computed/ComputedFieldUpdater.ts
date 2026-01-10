import {
  domainError,
  type DomainError,
  type IExecutionContext,
  type ILogger,
  type ITableRepository,
  type LinkField,
  LinkRelationship,
  RecordId,
  Table,
  TableId,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { InsertQueryBuilder, Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { DynamicDB, QB } from '../query-builder';
import { ComputedTableRecordQueryBuilder } from '../query-builder/computed';
// NOTE: SameTableBatchQueryBuilder will be used for CTE optimization in future versions
// import { SameTableBatchQueryBuilder, type SameTableFieldLevel } from '../query-builder/computed/SameTableBatchQueryBuilder';
import {
  type ComputedUpdateLockConfig,
  type ComputedUpdateLockSummary,
  buildAdvisoryLockQuery,
  buildComputedUpdateLockPlan,
  defaultComputedUpdateLockConfig,
} from './ComputedUpdateLock';
import type {
  ComputedDependencyEdge,
  ComputedSeedGroup,
  ComputedUpdatePlan,
  SameTableBatch,
  UpdateStep,
} from './ComputedUpdatePlanner';
import {
  createComputedUpdateRun,
  type ComputedUpdateRunContext,
  toRunLogContext,
  toRunSpanAttributes,
} from './ComputedUpdateRun';
import { UpdateFromSelectBuilder } from './UpdateFromSelectBuilder';

const DIRTY_TABLE = 'tmp_computed_dirty';
const DIRTY_TABLE_ID_COL = 'table_id';
const DIRTY_RECORD_ID_COL = 'record_id';

/**
 * Statistics about dirty record propagation for tracing purposes.
 */
export interface DirtyRecordStats {
  tableId: string;
  recordCount: number;
}

/**
 * Trace information for a single update step execution.
 */
interface StepTraceInfo {
  tableId: string;
  tableName: string;
  level: number;
  fieldIds: string[];
  fieldNames: string[];
  sql: string;
  parameterCount: number;
  dirtyRecordCount: number;
}

export type PreparedDirtyState = {
  db: Kysely<DynamicDB>;
  tableById: Map<string, Table>;
  dirtyStats: ReadonlyArray<DirtyRecordStats>;
  totalDirtyRecords: number;
};

type ComputedUpdateLockOptions = {
  logContext?: Record<string, unknown>;
};

/**
 * Execute computed field update plans using UPDATE...FROM.
 *
 * Example
 * ```typescript
 * const result = await updater.execute(plan, context);
 * if (result.isErr()) logger.error(result.error.message);
 * ```
 */
@injectable()
export class ComputedFieldUpdater {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateLockConfig)
    private readonly lockConfig: ComputedUpdateLockConfig = defaultComputedUpdateLockConfig
  ) {}

  async execute(
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    run?: ComputedUpdateRunContext
  ): Promise<Result<void, DomainError>> {
    if (
      plan.steps.length === 0 ||
      (plan.seedRecordIds.length === 0 && plan.extraSeedRecords.length === 0)
    ) {
      return ok(undefined);
    }

    const resolvedRun =
      run ??
      createComputedUpdateRun({
        totalSteps: plan.steps.length,
        completedStepsBefore: 0,
        phase: 'full',
      });
    const runLogger = this.logger.child(toRunLogContext(resolvedRun));
    const runStartTime = Date.now();

    // Collect table and field summary for tracing
    const affectedTableIds = [...new Set(plan.steps.map((s) => s.tableId.toString()))];
    const affectedFieldIds = [
      ...new Set(plan.steps.flatMap((s) => s.fieldIds.map((f) => f.toString()))),
    ];

    // Start main span for the entire computed update execution
    const mainSpan = context.tracer?.startSpan('teable.ComputedFieldUpdater.execute', {
      // Plan identification
      'computed.baseId': plan.baseId.toString(),
      'computed.seedTableId': plan.seedTableId.toString(),
      'computed.changeType': plan.changeType,
      // Record counts
      'computed.seedRecordCount': plan.seedRecordIds.length,
      'computed.extraSeedGroupCount': plan.extraSeedRecords.length,
      // Step and edge counts
      'computed.stepCount': plan.steps.length,
      'computed.edgeCount': plan.edges.length,
      // Affected scope
      'computed.affectedTableCount': affectedTableIds.length,
      'computed.affectedFieldCount': affectedFieldIds.length,
      'computed.affectedTableIds': affectedTableIds.join(','),
      // Complexity estimate
      'computed.estimatedComplexity': plan.estimatedComplexity,
      // Step levels summary (min/max)
      'computed.minLevel': plan.steps.length > 0 ? Math.min(...plan.steps.map((s) => s.level)) : 0,
      'computed.maxLevel': plan.steps.length > 0 ? Math.max(...plan.steps.map((s) => s.level)) : 0,
    });
    mainSpan?.setAttributes(toRunSpanAttributes(resolvedRun));

    // Log plan summary for structured logging
    runLogger.info('computed:run:start', {
      baseId: plan.baseId.toString(),
      seedTableId: plan.seedTableId.toString(),
      changeType: plan.changeType,
      totalSteps: resolvedRun.totalSteps,
      completedStepsBefore: resolvedRun.completedStepsBefore,
      pendingSteps: Math.max(resolvedRun.totalSteps - resolvedRun.completedStepsBefore, 0),
    });

    runLogger.debug('computed:plan', {
      baseId: plan.baseId.toString(),
      seedTableId: plan.seedTableId.toString(),
      seedRecordIds: plan.seedRecordIds.map((r) => r.toString()),
      steps: plan.steps.map((s) => ({
        tableId: s.tableId.toString(),
        level: s.level,
        fieldIds: s.fieldIds.map((f) => f.toString()),
      })),
      edges: plan.edges.map((e) => ({
        from: `${e.fromTableId.toString()}.${e.fromFieldId.toString()}`,
        to: `${e.toTableId.toString()}.${e.toFieldId.toString()}`,
        linkFieldId: e.linkFieldId?.toString(),
        order: e.order,
      })),
      sameTableBatches: plan.sameTableBatches.map((b) => ({
        tableId: b.tableId.toString(),
        stepCount: b.steps.length,
        minLevel: b.minLevel,
        maxLevel: b.maxLevel,
        fieldCount: b.steps.reduce((acc, s) => acc + s.fieldIds.length, 0),
      })),
    });

    // Log batch optimization opportunities
    const multiStepBatches = plan.sameTableBatches.filter((b) => b.steps.length > 1);
    if (multiStepBatches.length > 0) {
      mainSpan?.setAttribute('computed.sameTableBatchCount', plan.sameTableBatches.length);
      mainSpan?.setAttribute('computed.optimizableBatchCount', multiStepBatches.length);
      runLogger.debug('computed:batches:optimizable', {
        batchCount: multiStepBatches.length,
        batches: multiStepBatches.map((b) => ({
          tableId: b.tableId.toString(),
          stepCount: b.steps.length,
          levelRange: `${b.minLevel}-${b.maxLevel}`,
        })),
      });
    }

    const runWork = async () =>
      safeTry<void, DomainError>(
        async function* (this: ComputedFieldUpdater) {
          const prepared = yield* await this.prepareDirtyState(plan, context);
          mainSpan?.setAttribute('computed.totalDirtyRecords', prepared.totalDirtyRecords);
          mainSpan?.setAttribute('computed.affectedTableCount', prepared.dirtyStats.length);

          runLogger.debug('computed:dirtyStats', {
            totalDirtyRecords: prepared.totalDirtyRecords,
            affectedTables: prepared.dirtyStats,
          });

          const stepTraces = yield* await this.executePreparedSteps(
            plan,
            context,
            prepared,
            plan.steps,
            resolvedRun
          );
          mainSpan?.setAttribute('computed.executedStepCount', stepTraces.length);

          const completedSteps = resolvedRun.completedStepsBefore + stepTraces.length;
          runLogger.info('computed:run:done', {
            completedSteps,
            pendingSteps: Math.max(resolvedRun.totalSteps - completedSteps, 0),
            durationMs: Date.now() - runStartTime,
          });

          return ok(undefined);
        }.bind(this)
      );

    try {
      if (mainSpan && context.tracer) {
        return await context.tracer.withSpan(mainSpan, runWork);
      }
      return await runWork();
    } finally {
      mainSpan?.end();
    }
  }

  async acquireLocks(
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    options?: ComputedUpdateLockOptions
  ): Promise<Result<ComputedUpdateLockSummary, DomainError>> {
    const lockPlan = buildComputedUpdateLockPlan(plan, this.lockConfig);
    const summary = lockPlan.summary;
    if (summary.mode === 'disabled' || summary.mode === 'none') {
      return ok(summary);
    }

    const logContext = options?.logContext
      ? { ...summary, lockReason: lockPlan.reason, ...options.logContext }
      : { ...summary, lockReason: lockPlan.reason };

    const lockSpan = context.tracer?.startSpan('teable.ComputedUpdateLock.acquire', {
      'computed.baseId': plan.baseId.toString(),
      'computed.seedTableId': plan.seedTableId.toString(),
      'computed.lockMode': summary.mode,
      'computed.lockCount': summary.totalLocks,
      'computed.lockTableCount': summary.tableLocks,
      'computed.lockRecordCount': summary.recordLocks,
      'computed.lockSeedRecordCount': summary.seedRecordCount,
    });

    const runWork = async (): Promise<Result<ComputedUpdateLockSummary, DomainError>> => {
      const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;
      try {
        for (const statement of lockPlan.statements) {
          await db.executeQuery(buildAdvisoryLockQuery(db, statement.key));
        }
      } catch (error) {
        return err(
          domainError.infrastructure({
            message: `Failed to acquire computed update locks: ${describeError(error)}`,
          })
        );
      }

      this.logger.debug('computed:locks:acquired', logContext);
      return ok(summary);
    };

    try {
      if (lockSpan && context.tracer) {
        return await context.tracer.withSpan(lockSpan, runWork);
      }
      return await runWork();
    } finally {
      lockSpan?.end();
    }
  }

  /**
   * Prepare dirty table state (seed + propagate) and return dirty stats.
   *
   * Example
   * ```typescript
   * const prepared = await updater.prepareDirtyState(plan, context);
   * if (prepared.isOk()) console.log(prepared.value.dirtyStats);
   * ```
   */
  async prepareDirtyState(
    plan: ComputedUpdatePlan,
    context: IExecutionContext
  ): Promise<Result<PreparedDirtyState, DomainError>> {
    if (
      plan.steps.length === 0 ||
      (plan.seedRecordIds.length === 0 && plan.extraSeedRecords.length === 0)
    ) {
      const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;
      return ok({
        db,
        tableById: new Map(),
        dirtyStats: [],
        totalDirtyRecords: 0,
      });
    }

    const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

    return safeTry<PreparedDirtyState, DomainError>(
      async function* (this: ComputedFieldUpdater) {
        // Helper to run work within a span context so child DB operations are properly nested
        const runWithSpan = async <T>(
          name: string,
          work: () => Promise<T>,
          attrs?: Record<string, string | number>
        ): Promise<T> => {
          const span = context.tracer?.startSpan(name, attrs);
          if (span && context.tracer) {
            try {
              return await context.tracer.withSpan(span, work);
            } finally {
              span.end();
            }
          } else {
            return work();
          }
        };

        // Load tables - wrap with span to capture DB queries
        const loadTablesResult = yield* await runWithSpan(
          'teable.ComputedFieldUpdater.loadTables',
          () => this.loadTables(plan, context)
        );
        const tableById = new Map(loadTablesResult.map((table) => [table.id().toString(), table]));

        // Reset dirty table - wrap with span
        yield* await runWithSpan('teable.ComputedFieldUpdater.resetDirtyTable', () =>
          resetDirtyTable(db)
        );

        // Seed dirty records - wrap with span
        yield* await runWithSpan(
          'teable.ComputedFieldUpdater.seedDirtyRecords',
          async () => {
            const result = await seedDirtyRecords(db, plan.seedTableId, plan.seedRecordIds);
            if (result.isErr()) return result;
            return seedExtraDirtyRecords(db, plan.extraSeedRecords);
          },
          {
            seedCount: plan.seedRecordIds.length,
            extraSeedCount: plan.extraSeedRecords.length,
          }
        );

        // Propagate dirty records - wrap with span so propagateEdge spans are children
        yield* await runWithSpan(
          'teable.ComputedFieldUpdater.propagateDirtyRecords',
          () => propagateDirtyRecords(db, plan.edges, tableById, context),
          { 'propagate.edgeCount': plan.edges.length }
        );

        // Collect dirty stats - wrap with span
        const dirtyStats = yield* await runWithSpan(
          'teable.ComputedFieldUpdater.collectDirtyStats',
          () => this.collectDirtyRecordStats(db)
        );
        const totalDirtyRecords = dirtyStats.reduce((sum, s) => sum + s.recordCount, 0);

        return ok({
          db,
          tableById,
          dirtyStats,
          totalDirtyRecords,
        });
      }.bind(this)
    );
  }

  /**
   * Execute selected steps using a prepared dirty table state.
   *
   * Example
   * ```typescript
   * const prepared = await updater.prepareDirtyState(plan, context);
   * await updater.executePreparedSteps(plan, context, prepared.value, plan.steps);
   * ```
   */
  async executePreparedSteps(
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    prepared: PreparedDirtyState,
    steps: ReadonlyArray<UpdateStep> = plan.steps,
    run?: ComputedUpdateRunContext
  ): Promise<Result<ReadonlyArray<StepTraceInfo>, DomainError>> {
    if (steps.length === 0) return ok([]);

    const updateBuilder = new UpdateFromSelectBuilder(prepared.db);
    const stepTraces: StepTraceInfo[] = [];
    const runLogger = run ? this.logger.child(toRunLogContext(run)) : this.logger;

    // Group steps by level for organized tracing
    const stepsByLevel = new Map<number, Array<{ index: number; step: UpdateStep }>>();
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const levelSteps = stepsByLevel.get(step.level) ?? [];
      levelSteps.push({ index: i, step });
      stepsByLevel.set(step.level, levelSteps);
    }

    const levels = [...stepsByLevel.keys()].sort((a, b) => a - b);

    for (const level of levels) {
      const levelSteps = stepsByLevel.get(level)!;

      // Create a span for each level
      const levelSpan = context.tracer?.startSpan('teable.ComputedFieldUpdater.level', {
        'level.index': level,
        'level.stepCount': levelSteps.length,
        'level.tableIds': levelSteps.map((s) => s.step.tableId.toString()).join(','),
      });

      const executeLevel = async (): Promise<Result<StepTraceInfo[], DomainError>> => {
        const results: StepTraceInfo[] = [];
        for (const { index, step } of levelSteps) {
          const doneSteps = run ? run.completedStepsBefore + index + 1 : undefined;
          const pendingSteps =
            run && doneSteps !== undefined ? Math.max(run.totalSteps - doneSteps, 0) : undefined;

          if (run && doneSteps !== undefined && pendingSteps !== undefined) {
            runLogger.debug('computed:run:step', {
              stepIndex: doneSteps,
              stepCount: run.totalSteps,
              pendingSteps,
              tableId: step.tableId.toString(),
              level: step.level,
              fieldIds: step.fieldIds.map((f) => f.toString()),
            });
          }

          const stepResult = await this.executeStep(
            prepared.db,
            updateBuilder,
            step,
            prepared.tableById,
            context,
            index,
            run,
            doneSteps,
            pendingSteps
          );

          if (stepResult.isErr()) {
            levelSpan?.recordError(stepResult.error.message);
            levelSpan?.end();
            return err(stepResult.error);
          }

          results.push(stepResult.value);
        }
        return ok(results);
      };

      let levelResults: Result<StepTraceInfo[], DomainError>;
      if (levelSpan && context.tracer) {
        levelResults = await context.tracer.withSpan(levelSpan, executeLevel);
      } else {
        levelResults = await executeLevel();
      }
      levelSpan?.end();

      if (levelResults.isErr()) {
        return err(levelResults.error);
      }

      stepTraces.push(...levelResults.value);
    }
    return ok(stepTraces);
  }

  /**
   * Execute a single update step with tracing.
   */
  private async executeStep(
    db: Kysely<DynamicDB>,
    updateBuilder: UpdateFromSelectBuilder,
    step: UpdateStep,
    tableById: Map<string, Table>,
    context: IExecutionContext,
    stepIndex: number,
    run?: ComputedUpdateRunContext,
    doneSteps?: number,
    pendingSteps?: number
  ): Promise<Result<StepTraceInfo, DomainError>> {
    const table = tableById.get(step.tableId.toString());
    const tableName = table
      ? table
          .dbTableName()
          .andThen((n) => n.value())
          .unwrapOr(step.tableId.toString())
      : step.tableId.toString();

    // Collect field names for tracing
    const fieldNames: string[] = [];
    for (const fieldId of step.fieldIds) {
      if (table) {
        const fieldResult = table.getField((f) => f.id().equals(fieldId));
        if (fieldResult.isOk()) {
          fieldNames.push(fieldResult.value.name().toString());
        } else {
          fieldNames.push(fieldId.toString());
        }
      } else {
        fieldNames.push(fieldId.toString());
      }
    }

    // Get dirty record count for this table
    const dirtyCount = await this.getDirtyCountForTable(db, step.tableId);

    const stepSpan = context.tracer?.startSpan('teable.ComputedFieldUpdater.step', {
      // Basic step info
      'step.index': stepIndex,
      'step.level': step.level,
      'step.fieldCount': step.fieldIds.length,
      // Table info
      'step.tableId': step.tableId.toString(),
      'step.tableName': tableName,
      // Field info (both IDs and names for readability)
      'step.fieldIds': step.fieldIds.map((f) => f.toString()).join(','),
      'step.fieldNames': fieldNames.join(','),
      // Dirty record info
      'step.dirtyRecordCount': dirtyCount,
    });

    if (run) {
      stepSpan?.setAttributes(toRunSpanAttributes(run));
      if (doneSteps !== undefined) stepSpan?.setAttribute('step.position', doneSteps);
      if (pendingSteps !== undefined) stepSpan?.setAttribute('step.pending', pendingSteps);
    }

    try {
      return await safeTry<StepTraceInfo, DomainError>(
        async function* (this: ComputedFieldUpdater) {
          if (!table) {
            return err(
              domainError.notFound({
                message: `Missing table for computed update: ${step.tableId.toString()}`,
              })
            );
          }

          const builder = new ComputedTableRecordQueryBuilder(db).from(table).select(step.fieldIds);
          yield* await builder.prepare({
            context,
            tableRepository: this.tableRepository,
          });
          const selectQuery = yield* builder.build();

          const compiled = yield* updateBuilder.build({
            table,
            fieldIds: step.fieldIds,
            selectQuery,
            dirtyFilter: { tableId: step.tableId },
          });

          // Record SQL on span
          stepSpan?.setAttribute('step.sql', compiled.sql);
          stepSpan?.setAttribute('step.parameterCount', compiled.parameters.length);

          const sqlLogContext = run
            ? { ...toRunLogContext(run), parameters: compiled.parameters }
            : { parameters: compiled.parameters };
          this.logger.debug(
            `computed:update:table=${tableName}:level=${step.level}:sql:\n${compiled.sql}`,
            sqlLogContext
          );

          await db.executeQuery(compiled);

          const traceInfo: StepTraceInfo = {
            tableId: step.tableId.toString(),
            tableName,
            level: step.level,
            fieldIds: step.fieldIds.map((f) => f.toString()),
            fieldNames,
            sql: compiled.sql,
            parameterCount: compiled.parameters.length,
            dirtyRecordCount: dirtyCount,
          };

          return ok(traceInfo);
        }.bind(this)
      );
    } finally {
      stepSpan?.end();
    }
  }

  /**
   * Execute a same-table batch using CTE optimization when possible.
   *
   * Currently, this method checks if the batch can be optimized (all formula fields)
   * and logs the opportunity. Full CTE optimization will be implemented in a future version.
   *
   * @param batch The same-table batch to execute
   * @param prepared The prepared dirty state
   * @param context Execution context
   * @returns Result containing trace info for all executed steps
   */
  async executeSameTableBatch(
    batch: SameTableBatch,
    prepared: PreparedDirtyState,
    context: IExecutionContext,
    run?: ComputedUpdateRunContext
  ): Promise<Result<StepTraceInfo[], DomainError>> {
    const table = prepared.tableById.get(batch.tableId.toString());
    if (!table) {
      return err(
        domainError.notFound({
          message: `Table not found for batch: ${batch.tableId.toString()}`,
        })
      );
    }

    const tableName = table
      .dbTableName()
      .andThen((n) => n.value())
      .unwrapOr(batch.tableId.toString());

    const batchSpan = context.tracer?.startSpan('teable.ComputedFieldUpdater.sameTableBatch', {
      'batch.tableId': batch.tableId.toString(),
      'batch.tableName': tableName,
      'batch.stepCount': batch.steps.length,
      'batch.minLevel': batch.minLevel,
      'batch.maxLevel': batch.maxLevel,
      'batch.totalFieldCount': batch.steps.reduce((acc, s) => acc + s.fieldIds.length, 0),
    });

    try {
      // Check if batch can use CTE optimization (all formula fields)
      const canOptimize = await this.canBatchOptimize(batch, prepared);
      batchSpan?.setAttribute('batch.canOptimize', canOptimize);

      if (canOptimize && batch.steps.length > 1) {
        // TODO: Implement CTE-based batch execution
        // For now, log the optimization opportunity and fall back to step-by-step
        this.logger.debug('computed:batch:optimizable', {
          tableId: batch.tableId.toString(),
          tableName,
          stepCount: batch.steps.length,
          levelRange: `${batch.minLevel}-${batch.maxLevel}`,
          message: 'CTE optimization available but not yet implemented',
        });
      }

      // Fall back to step-by-step execution
      const updateBuilder = new UpdateFromSelectBuilder(prepared.db);
      const traces: StepTraceInfo[] = [];

      for (let i = 0; i < batch.steps.length; i++) {
        const step = batch.steps[i];
        const result = await this.executeStep(
          prepared.db,
          updateBuilder,
          step,
          prepared.tableById,
          context,
          i,
          run
        );
        if (result.isErr()) return err(result.error);
        traces.push(result.value);
      }

      return ok(traces);
    } finally {
      batchSpan?.end();
    }
  }

  /**
   * Check if a batch can be optimized using CTE.
   * Currently requires all fields to be formulas (no lookup/rollup/link).
   */
  private async canBatchOptimize(
    batch: SameTableBatch,
    prepared: PreparedDirtyState
  ): Promise<boolean> {
    const table = prepared.tableById.get(batch.tableId.toString());
    if (!table) return false;

    // Check if all fields in the batch are formulas
    for (const step of batch.steps) {
      for (const fieldId of step.fieldIds) {
        const fieldResult = table.getField((f) => f.id().equals(fieldId));
        if (fieldResult.isErr()) return false;

        const field = fieldResult.value;
        // Only formulas can be CTE-optimized
        // Lookup/rollup need lateral joins which don't work well with CTEs
        // Link fields have their own lateral join logic
        if (field.type().toString() !== 'formula') {
          return false;
        }
      }
    }

    return batch.steps.length > 1;
  }

  /**
   * Get the count of dirty records for a specific table.
   */
  private async getDirtyCountForTable(db: Kysely<DynamicDB>, tableId: TableId): Promise<number> {
    try {
      const result = await db
        .selectFrom(DIRTY_TABLE)
        .select(sql<number>`count(*)`.as('count'))
        .where(DIRTY_TABLE_ID_COL, '=', tableId.toString())
        .executeTakeFirst();
      return result ? Number(result.count) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Collect statistics about dirty records per table for tracing.
   */
  private async collectDirtyRecordStats(
    db: Kysely<DynamicDB>
  ): Promise<Result<DirtyRecordStats[], DomainError>> {
    try {
      const result = await db
        .selectFrom(DIRTY_TABLE)
        .select([
          sql.ref(DIRTY_TABLE_ID_COL).as('tableId'),
          sql<number>`count(*)`.as('recordCount'),
        ])
        .groupBy(DIRTY_TABLE_ID_COL)
        .execute();

      return ok(
        result.map((row) => ({
          tableId: String(row.tableId),
          recordCount: Number(row.recordCount),
        }))
      );
    } catch (error) {
      // Non-critical: return empty stats if query fails
      this.logger.warn('computed:dirtyStats:failed', { error: describeError(error) });
      return ok([]);
    }
  }

  private async loadTables(
    plan: ComputedUpdatePlan,
    context: IExecutionContext
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return safeTry<ReadonlyArray<Table>, DomainError>(
      async function* (this: ComputedFieldUpdater) {
        const tableIds = new Map<string, TableId>();
        tableIds.set(plan.seedTableId.toString(), plan.seedTableId);
        for (const step of plan.steps) {
          tableIds.set(step.tableId.toString(), step.tableId);
        }
        for (const edge of plan.edges) {
          tableIds.set(edge.fromTableId.toString(), edge.fromTableId);
          tableIds.set(edge.toTableId.toString(), edge.toTableId);
        }

        if (tableIds.size === 0) return ok([]);

        const spec = yield* Table.specs(plan.baseId)
          .withoutBaseId()
          .byIds([...tableIds.values()])
          .build();
        const tables = yield* await this.tableRepository.find(context, spec);

        return ok(tables);
      }.bind(this)
    );
  }

  /**
   * Collect dirty record ids per table for chaining to the next stage.
   */
  async collectDirtySeedGroups(
    context: IExecutionContext,
    tableIds: ReadonlyArray<TableId>
  ): Promise<Result<ComputedSeedGroup[], DomainError>> {
    const uniqueTableIds = [...new Set(tableIds.map((id) => id.toString()))];
    if (uniqueTableIds.length === 0) return ok([]);

    const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;
    try {
      const rows = await db
        .selectFrom(DIRTY_TABLE)
        .select([
          sql.ref(DIRTY_TABLE_ID_COL).as('tableId'),
          sql.ref(DIRTY_RECORD_ID_COL).as('recordId'),
        ])
        .where(DIRTY_TABLE_ID_COL, 'in', uniqueTableIds)
        .execute();

      const tableIdMap = new Map<string, TableId>();
      for (const tableId of tableIds) {
        tableIdMap.set(tableId.toString(), tableId);
      }

      const groups = new Map<string, { tableId: TableId; recordIds: RecordId[] }>();
      for (const row of rows) {
        const tableIdValue = String(row.tableId);
        const recordIdValue = String(row.recordId);
        const tableIdResult = tableIdMap.has(tableIdValue)
          ? ok(tableIdMap.get(tableIdValue)!)
          : TableId.create(tableIdValue);
        if (tableIdResult.isErr()) return err(tableIdResult.error);

        const recordIdResult = RecordId.create(recordIdValue);
        if (recordIdResult.isErr()) return err(recordIdResult.error);

        const entry = groups.get(tableIdValue) ?? {
          tableId: tableIdResult.value,
          recordIds: [],
        };
        entry.recordIds.push(recordIdResult.value);
        groups.set(tableIdValue, entry);
      }

      return ok([...groups.values()]);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to collect dirty record ids: ${describeError(error)}`,
        })
      );
    }
  }
}

const resetDirtyTable = async (db: Kysely<DynamicDB>): Promise<Result<void, DomainError>> => {
  try {
    await db.executeQuery(sql`drop table if exists ${sql.table(DIRTY_TABLE)}`.compile(db));
    await db.executeQuery(
      sql`create temporary table ${sql.table(DIRTY_TABLE)} (
        ${sql.raw(DIRTY_TABLE_ID_COL)} text not null,
        ${sql.raw(DIRTY_RECORD_ID_COL)} text not null,
        primary key (${sql.raw(DIRTY_TABLE_ID_COL)}, ${sql.raw(DIRTY_RECORD_ID_COL)})
      ) on commit drop`.compile(db)
    );
    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to create dirty table: ${describeError(error)}`,
      })
    );
  }
};

const seedDirtyRecords = async (
  db: Kysely<DynamicDB>,
  tableId: TableId,
  recordIds: ReadonlyArray<{ toString(): string }>
): Promise<Result<void, DomainError>> => {
  if (recordIds.length === 0) return ok(undefined);

  try {
    const values = recordIds.map((recordId) => ({
      [DIRTY_TABLE_ID_COL]: tableId.toString(),
      [DIRTY_RECORD_ID_COL]: recordId.toString(),
    }));
    const batchSize = 500;
    for (let i = 0; i < values.length; i += batchSize) {
      await db
        .insertInto(DIRTY_TABLE)
        .values(values.slice(i, i + batchSize))
        .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
        .execute();
    }
    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to seed dirty records: ${describeError(error)}`,
      })
    );
  }
};

const seedExtraDirtyRecords = async (
  db: Kysely<DynamicDB>,
  extraSeedRecords: ReadonlyArray<{
    tableId: TableId;
    recordIds: ReadonlyArray<{ toString(): string }>;
  }>
): Promise<Result<void, DomainError>> => {
  for (const group of extraSeedRecords) {
    if (group.recordIds.length === 0) continue;
    const result = await seedDirtyRecords(db, group.tableId, group.recordIds);
    if (result.isErr()) return err(result.error);
  }
  return ok(undefined);
};

const propagateDirtyRecords = async (
  db: Kysely<DynamicDB>,
  edges: ReadonlyArray<ComputedDependencyEdge>,
  tableById: Map<string, Table>,
  context?: IExecutionContext
): Promise<Result<void, DomainError>> => {
  try {
    const countDirtyRecords = async (): Promise<number> => {
      const result = await db
        .selectFrom(DIRTY_TABLE)
        .select(sql<number>`count(*)`.as('count'))
        .executeTakeFirst();
      return result ? Number(result.count) : 0;
    };

    const maxPasses = Math.max(edges.length, 1);
    let previousCount = await countDirtyRecords();

    for (let pass = 0; pass < maxPasses; pass += 1) {
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];

        // Resolve table and field names for better tracing readability
        const sourceTable = tableById.get(edge.fromTableId.toString());
        const targetTable = tableById.get(edge.toTableId.toString());

        const sourceTableName = sourceTable
          ? sourceTable
              .dbTableName()
              .andThen((n) => n.value())
              .unwrapOr(edge.fromTableId.toString())
          : edge.fromTableId.toString();

        const targetTableName = targetTable
          ? targetTable
              .dbTableName()
              .andThen((n) => n.value())
              .unwrapOr(edge.toTableId.toString())
          : edge.toTableId.toString();

        // Resolve field names
        let fromFieldName = edge.fromFieldId.toString();
        let toFieldName = edge.toFieldId.toString();
        let linkFieldName = edge.linkFieldId?.toString() ?? '';

        if (sourceTable) {
          const fieldResult = sourceTable.getField((f) => f.id().equals(edge.fromFieldId));
          if (fieldResult.isOk()) {
            fromFieldName = fieldResult.value.name().toString();
          }
        }

        if (targetTable) {
          const fieldResult = targetTable.getField((f) => f.id().equals(edge.toFieldId));
          if (fieldResult.isOk()) {
            toFieldName = fieldResult.value.name().toString();
          }

          if (edge.linkFieldId) {
            const linkFieldResult = targetTable.getField((f) => f.id().equals(edge.linkFieldId!));
            if (linkFieldResult.isOk()) {
              linkFieldName = linkFieldResult.value.name().toString();
            }
          }
        }

        const edgeSpan = context?.tracer?.startSpan('teable.ComputedFieldUpdater.propagateEdge', {
          // Edge index and order
          'edge.index': i,
          'edge.order': edge.order,
          // Source info (IDs and names)
          'edge.fromTableId': edge.fromTableId.toString(),
          'edge.fromTableName': sourceTableName,
          'edge.fromFieldId': edge.fromFieldId.toString(),
          'edge.fromFieldName': fromFieldName,
          // Target info (IDs and names)
          'edge.toTableId': edge.toTableId.toString(),
          'edge.toTableName': targetTableName,
          'edge.toFieldId': edge.toFieldId.toString(),
          'edge.toFieldName': toFieldName,
          // Link field info
          'edge.linkFieldId': edge.linkFieldId?.toString() ?? '',
          'edge.linkFieldName': linkFieldName,
          // Direction description for quick understanding
          'edge.description': `${sourceTableName}.${fromFieldName} → ${targetTableName}.${toFieldName}`,
          // Pass information for debugging propagation order
          'edge.pass': pass,
        });

        try {
          const insertResult = buildPropagationInsert(db, edge, tableById);
          if (insertResult.isErr()) {
            edgeSpan?.recordError(insertResult.error.message);
            return err(insertResult.error);
          }

          const compiled = insertResult.value.compile();
          edgeSpan?.setAttribute('edge.sql', compiled.sql);
          await db.executeQuery(compiled);
        } finally {
          edgeSpan?.end();
        }
      }

      const nextCount = await countDirtyRecords();
      if (nextCount === previousCount) {
        break;
      }
      previousCount = nextCount;
    }
    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to propagate dirty records: ${describeError(error)}`,
      })
    );
  }
};

const buildPropagationInsert = (
  db: Kysely<DynamicDB>,
  edge: ComputedDependencyEdge,
  tableById: Map<string, Table>
): Result<InsertQueryBuilder<DynamicDB, string, unknown>, DomainError> => {
  return safeTry(function* () {
    const targetTable = tableById.get(edge.toTableId.toString());
    if (!targetTable) {
      return err(
        domainError.notFound({
          message: `Missing target table ${edge.toTableId.toString()}`,
        })
      );
    }

    if (edge.propagationMode === 'allTargetRecords') {
      const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());
      const dirtyGate = db
        .selectFrom(`${DIRTY_TABLE} as d`)
        .select(sql.ref(`d.${DIRTY_TABLE_ID_COL}`).as(DIRTY_TABLE_ID_COL))
        .where(`d.${DIRTY_TABLE_ID_COL}`, '=', edge.fromTableId.toString())
        .limit(1)
        .as('dg');

      const select = db
        .selectFrom(`${targetDbName} as t`)
        .innerJoin(dirtyGate, (join) => join.onTrue())
        .select([
          sql.lit(edge.toTableId.toString()).as(DIRTY_TABLE_ID_COL),
          sql.ref('t.__id').as(DIRTY_RECORD_ID_COL),
        ])
        .distinct();

      return ok(
        db
          .insertInto(DIRTY_TABLE)
          .columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL])
          .expression(select)
          .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
      );
    }

    if (!edge.linkFieldId) return err(domainError.validation({ message: 'Missing linkFieldId' }));
    const sourceTable = tableById.get(edge.fromTableId.toString());
    if (!sourceTable) {
      return err(
        domainError.notFound({
          message: `Missing source table ${edge.fromTableId.toString()}`,
        })
      );
    }

    const linkField = yield* targetTable.getField((field): field is LinkField =>
      field.id().equals(edge.linkFieldId!)
    );

    if (!linkField.foreignTableId().equals(edge.fromTableId)) {
      return err(
        domainError.validation({
          message: `Link field ${edge.linkFieldId.toString()} does not reference table ${edge.fromTableId.toString()}`,
        })
      );
    }

    const sourceDbName = yield* sourceTable.dbTableName().andThen((name) => name.value());
    const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());

    const relationship = linkField.relationship();
    const insertQuery = yield* buildDirtyInsertQuery({
      db,
      relationship,
      linkField,
      sourceTableName: sourceDbName,
      targetTableName: targetDbName,
      sourceTableId: edge.fromTableId.toString(),
      targetTableId: edge.toTableId.toString(),
    });

    return ok(insertQuery);
  });
};

type DirtyInsertParams = {
  db: Kysely<DynamicDB>;
  relationship: LinkRelationship;
  linkField: LinkField;
  sourceTableName: string;
  targetTableName: string;
  sourceTableId: string;
  targetTableId: string;
};

const buildDirtyInsertQuery = (
  params: DirtyInsertParams
): Result<InsertQueryBuilder<DynamicDB, string, unknown>, DomainError> => {
  return safeTry(function* () {
    const {
      db,
      relationship,
      linkField,
      sourceTableName,
      targetTableName,
      sourceTableId,
      targetTableId,
    } = params;

    if (
      relationship.equals(LinkRelationship.manyOne()) ||
      relationship.equals(LinkRelationship.oneOne())
    ) {
      const foreignKey = yield* linkField.foreignKeyNameString();
      const select = db
        .selectFrom(`${targetTableName} as t`)
        .innerJoin(`${DIRTY_TABLE} as d`, `d.${DIRTY_RECORD_ID_COL}`, `t.${foreignKey}`)
        .where(`d.${DIRTY_TABLE_ID_COL}`, '=', sourceTableId)
        .select([
          sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
          sql.ref('t.__id').as(DIRTY_RECORD_ID_COL),
        ])
        .distinct();

      return ok(
        db
          .insertInto(DIRTY_TABLE)
          .columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL])
          .expression(select)
          .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
      );
    }

    if (relationship.equals(LinkRelationship.oneMany())) {
      if (linkField.isOneWay()) {
        const fkHostTableName = yield* linkField.fkHostTableNameString();
        const selfKey = yield* linkField.selfKeyNameString();
        const foreignKey = yield* linkField.foreignKeyNameString();
        const select = db
          .selectFrom(`${fkHostTableName} as j`)
          .innerJoin(`${DIRTY_TABLE} as d`, `d.${DIRTY_RECORD_ID_COL}`, `j.${foreignKey}`)
          .where(`d.${DIRTY_TABLE_ID_COL}`, '=', sourceTableId)
          .select([
            sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
            sql.ref(`j.${selfKey}`).as(DIRTY_RECORD_ID_COL),
          ])
          .distinct();

        return ok(
          db
            .insertInto(DIRTY_TABLE)
            .columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL])
            .expression(select)
            .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
        );
      }

      const selfKey = yield* linkField.selfKeyNameString();
      const select = db
        .selectFrom(`${sourceTableName} as f`)
        .innerJoin(`${DIRTY_TABLE} as d`, `d.${DIRTY_RECORD_ID_COL}`, 'f.__id')
        .where(`d.${DIRTY_TABLE_ID_COL}`, '=', sourceTableId)
        .where(sql.ref(`f.${selfKey}`), 'is not', null)
        .select([
          sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
          sql.ref(`f.${selfKey}`).as(DIRTY_RECORD_ID_COL),
        ])
        .distinct();

      return ok(
        db
          .insertInto(DIRTY_TABLE)
          .columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL])
          .expression(select)
          .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
      );
    }

    const fkHostTableName = yield* linkField.fkHostTableNameString();
    const selfKey = yield* linkField.selfKeyNameString();
    const foreignKey = yield* linkField.foreignKeyNameString();
    const select = db
      .selectFrom(`${fkHostTableName} as j`)
      .innerJoin(`${DIRTY_TABLE} as d`, `d.${DIRTY_RECORD_ID_COL}`, `j.${foreignKey}`)
      .where(`d.${DIRTY_TABLE_ID_COL}`, '=', sourceTableId)
      .select([
        sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
        sql.ref(`j.${selfKey}`).as(DIRTY_RECORD_ID_COL),
      ])
      .distinct();

    return ok(
      db
        .insertInto(DIRTY_TABLE)
        .columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL])
        .expression(select)
        .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
    );
  });
};

interface PostgresTransactionContext<DB> {
  kind: 'unitOfWorkTransaction';
  db: Transaction<DB>;
}

const getPostgresTransaction = <DB>(context: IExecutionContext): Transaction<DB> | null => {
  const transaction = context.transaction as Partial<PostgresTransactionContext<DB>> | undefined;
  if (transaction?.kind === 'unitOfWorkTransaction' && transaction.db) {
    return transaction.db as Transaction<DB>;
  }
  return null;
};

const resolvePostgresDb = <DB>(
  db: Kysely<DB>,
  context: IExecutionContext
): Kysely<DB> | Transaction<DB> => {
  return getPostgresTransaction<DB>(context) ?? db;
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};
