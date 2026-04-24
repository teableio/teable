import { resolvePostgresDbOrTx } from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  FieldType,
  FieldCondition,
  LinkRelationship,
  RecordId,
  Table,
  TableId,
  v2CoreTokens,
} from '@teable/v2-core';
import type {
  DomainError,
  IExecutionContext,
  ILogger,
  ITableRepository,
  LinkField,
  FieldId,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { formulaSqlPgTokens, type IPgTypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Expression, Kysely, SqlBool } from 'kysely';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { toQualifiedIdentifierLiteral } from '../../shared/sqlIdentifiers';
import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { DynamicDB, QB } from '../query-builder';
import { ComputedTableRecordQueryBuilder } from '../query-builder/computed';
import {
  SameTableBatchQueryBuilder,
  type SameTableFieldLevel,
} from '../query-builder/computed/SameTableBatchQueryBuilder';
import { TableRecordConditionWhereVisitor } from '../visitors/TableRecordConditionWhereVisitor';
import {
  COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE,
  type ComputedUpdateLockConfig,
  type ComputedUpdateLockSummary,
  buildAdvisoryLockQuery,
  buildComputedUpdateLockPlan,
  buildTryAdvisoryLockQuery,
  defaultComputedUpdateLockConfig,
} from './ComputedUpdateLock';
import type {
  AllTargetRecordsReason,
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
import { toErrorLogFields } from './errorLog';
import { isPersistedAsGeneratedColumn } from './isPersistedAsGeneratedColumn';
import { UpdateFromSelectBuilder } from './UpdateFromSelectBuilder';
import type { UpdatedRecordRow } from './UpdateFromSelectBuilder';

const DIRTY_TABLE = 'tmp_computed_dirty';
const DIRTY_TABLE_ID_COL = 'table_id';
const DIRTY_RECORD_ID_COL = 'record_id';
const BEFORE_IMAGE_TABLE = 'tmp_computed_before_image';
const BEFORE_IMAGE_SNAPSHOT_COL = 'field_values';
const SAME_TABLE_BATCH_CHUNK_TRIGGER = 1000;
const SAME_TABLE_BATCH_CHUNK_SIZE = 500;

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

/**
 * Change data for a single field in a record.
 */
export type FieldChangeData = {
  fieldId: string;
  newValue: unknown;
};

/**
 * Change data for a single record after computed update.
 */
export type RecordChangeData = {
  recordId: string;
  /** Version of the record BEFORE this computed update */
  oldVersion: number;
  changes: ReadonlyArray<FieldChangeData>;
};

/**
 * Change data for a single computed update step.
 */
export type StepChangeData = {
  tableId: string;
  recordChanges: ReadonlyArray<RecordChangeData>;
};

/**
 * Result of computed update execution with optional change data.
 */
export type ComputedUpdateResult = {
  /** Change data by step, used for event generation */
  changesByStep: ReadonlyArray<StepChangeData>;
};

const stepKey = (step: UpdateStep): string => `${step.tableId.toString()}|${step.level}`;

/**
 * Collapse multi-level same-table batches into a single step (per table),
 * keeping fieldIds ordered by dependency level (and stable within level).
 *
 * This is primarily for same-table formula chains where we can compute all formulas
 * in one UPDATE...FROM by selecting multiple fields at once.
 */
const optimizeSameTableBatches = (plan: ComputedUpdatePlan): ComputedUpdatePlan => {
  const crossRecordDependentFieldIds = new Set(
    plan.edges.flatMap((edge) =>
      (edge.propagationTargetFieldIds ?? [edge.toFieldId]).map((fieldId) => fieldId.toString())
    )
  );

  // Only collapse batches that are purely same-record computed fields across levels.
  // If a batch includes a cross-record-dependent field (e.g. lookup/rollup/link), keep
  // the original steps so tests and logs preserve level visibility for cross-table chains.
  const collapsibleBatches = plan.sameTableBatches.filter((b) => {
    if (b.steps.length <= 1) return false;
    return b.steps.every(
      (step) => !step.fieldIds.some((id) => crossRecordDependentFieldIds.has(id.toString()))
    );
  });
  if (collapsibleBatches.length === 0) return plan;

  const removeKeys = new Set<string>();
  const collapsedSteps: UpdateStep[] = [];

  for (const batch of collapsibleBatches) {
    for (const step of batch.steps) {
      removeKeys.add(stepKey(step));
    }

    const flattened: FieldId[] = [];
    const seen = new Set<string>();
    const orderedSteps = [...batch.steps].sort((a, b) => a.level - b.level);
    for (const step of orderedSteps) {
      for (const fieldId of step.fieldIds) {
        const key = fieldId.toString();
        if (seen.has(key)) continue;
        seen.add(key);
        flattened.push(fieldId);
      }
    }

    collapsedSteps.push({
      tableId: batch.tableId,
      level: batch.minLevel,
      fieldIds: flattened,
    });
  }

  const remainingSteps = plan.steps.filter((step) => !removeKeys.has(stepKey(step)));
  const optimizedSteps = [...remainingSteps, ...collapsedSteps].sort((a, b) =>
    a.level === b.level
      ? a.tableId.toString().localeCompare(b.tableId.toString())
      : a.level - b.level
  );

  return {
    ...plan,
    steps: optimizedSteps,
  };
};

/**
 * Statistics about dirty record propagation for tracing purposes.
 */
export interface DirtyRecordStats {
  tableId: string;
  recordCount: number;
}

type AllTargetReasonCounts = Partial<Record<AllTargetRecordsReason, number>>;

export type DirtyPropagationStats = {
  plannedAllTargetReasonCounts: AllTargetReasonCounts;
  runtimeAllTargetFallbackReasonCounts: AllTargetReasonCounts;
};

const incrementAllTargetReasonCount = (
  counts: AllTargetReasonCounts,
  reason: AllTargetRecordsReason | undefined
): void => {
  if (!reason) return;
  counts[reason] = (counts[reason] ?? 0) + 1;
};

const incrementAllTargetReasonCounts = (
  counts: AllTargetReasonCounts,
  reasons: ReadonlyArray<AllTargetRecordsReason> | undefined
): void => {
  for (const reason of reasons ?? []) {
    incrementAllTargetReasonCount(counts, reason);
  }
};

const countAllTargetReasonOccurrences = (counts: AllTargetReasonCounts): number =>
  Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0);

const summarizeAllTargetReasonCounts = (counts: AllTargetReasonCounts): string | undefined => {
  const entries = Object.entries(counts).filter(([, count]) => (count ?? 0) > 0);
  if (entries.length === 0) return undefined;
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}:${count}`)
    .join(',');
};

const countPlannedAllTargetReasonCounts = (
  edges: ReadonlyArray<ComputedDependencyEdge>
): AllTargetReasonCounts => {
  const counts: AllTargetReasonCounts = {};
  for (const edge of edges) {
    if (edge.propagationMode !== 'allTargetRecords') continue;
    incrementAllTargetReasonCounts(counts, edge.allTargetRecordsReasons);
  }
  return counts;
};

const emptyDirtyPropagationStats = (): DirtyPropagationStats => ({
  plannedAllTargetReasonCounts: {},
  runtimeAllTargetFallbackReasonCounts: {},
});

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

/**
 * Result of a single step execution including optional change data.
 */
interface StepExecutionResult {
  traceInfo: StepTraceInfo;
  recordChanges: ReadonlyArray<RecordChangeData>;
}

/**
 * Result from executePreparedSteps including optional change data.
 */
export type ExecutePreparedStepsResult = {
  traceInfos: ReadonlyArray<StepTraceInfo>;
  changesByStep: ReadonlyArray<StepChangeData>;
};

export type PreparedDirtyState = {
  db: Kysely<DynamicDB>;
  tableById: Map<string, Table>;
  dirtyStats: ReadonlyArray<DirtyRecordStats>;
  totalDirtyRecords: number;
  propagationStats: DirtyPropagationStats;
};

type ComputedUpdateLockOptions = {
  logContext?: Record<string, unknown>;
  wait?: boolean;
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
    private readonly lockConfig: ComputedUpdateLockConfig = defaultComputedUpdateLockConfig,
    @inject(formulaSqlPgTokens.typeValidationStrategy)
    private readonly typeValidationStrategy: IPgTypeValidationStrategy
  ) {}

  async execute(
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    run?: ComputedUpdateRunContext,
    options?: { collectChanges?: boolean }
  ): Promise<Result<ComputedUpdateResult, DomainError>> {
    const noSeedInput = plan.seedRecordIds.length === 0 && plan.extraSeedRecords.length === 0;
    const shouldSeedAllForSchemaUpdate = noSeedInput && plan.changeType === 'update';
    if (plan.steps.length === 0 || (noSeedInput && !shouldSeedAllForSchemaUpdate)) {
      return ok({ changesByStep: [] });
    }

    const effectivePlan = optimizeSameTableBatches(plan);

    const resolvedRun =
      run ??
      createComputedUpdateRun({
        totalSteps: effectivePlan.steps.length,
        completedStepsBefore: 0,
        phase: 'full',
      });
    const runLogger = this.logger.child(toRunLogContext(resolvedRun));
    const runStartTime = Date.now();
    const plannedAllTargetReasonCounts = countPlannedAllTargetReasonCounts(effectivePlan.edges);
    const plannedAllTargetReasonCount = countAllTargetReasonOccurrences(
      plannedAllTargetReasonCounts
    );
    const plannedAllTargetReasonSummary = summarizeAllTargetReasonCounts(
      plannedAllTargetReasonCounts
    );

    // Collect table and field summary for tracing
    const affectedTableIds = [...new Set(effectivePlan.steps.map((s) => s.tableId.toString()))];
    const affectedFieldIds = [
      ...new Set(effectivePlan.steps.flatMap((s) => s.fieldIds.map((f) => f.toString()))),
    ];

    // Start main span for the entire computed update execution
    const mainSpan = context.tracer?.startSpan('teable.ComputedFieldUpdater.execute', {
      // Plan identification
      'computed.baseId': effectivePlan.baseId.toString(),
      'computed.seedTableId': effectivePlan.seedTableId.toString(),
      'computed.changeType': effectivePlan.changeType,
      // Record counts
      'computed.seedRecordCount': effectivePlan.seedRecordIds.length,
      'computed.extraSeedGroupCount': effectivePlan.extraSeedRecords.length,
      // Step and edge counts
      'computed.stepCount': effectivePlan.steps.length,
      'computed.edgeCount': effectivePlan.edges.length,
      // Affected scope
      'computed.affectedTableCount': affectedTableIds.length,
      'computed.affectedFieldCount': affectedFieldIds.length,
      'computed.affectedTableIds': affectedTableIds.join(','),
      // Complexity estimate
      'computed.estimatedComplexity': effectivePlan.estimatedComplexity,
      'computed.plannedAllTargetReasonCount': plannedAllTargetReasonCount,
      // Step levels summary (min/max)
      'computed.minLevel':
        effectivePlan.steps.length > 0 ? Math.min(...effectivePlan.steps.map((s) => s.level)) : 0,
      'computed.maxLevel':
        effectivePlan.steps.length > 0 ? Math.max(...effectivePlan.steps.map((s) => s.level)) : 0,
    });
    mainSpan?.setAttributes(toRunSpanAttributes(resolvedRun));
    if (plannedAllTargetReasonSummary) {
      mainSpan?.setAttribute('computed.plannedAllTargetReasons', plannedAllTargetReasonSummary);
    }

    // Log plan summary for structured logging
    runLogger.info('computed:run:start', {
      baseId: effectivePlan.baseId.toString(),
      seedTableId: effectivePlan.seedTableId.toString(),
      changeType: effectivePlan.changeType,
      totalSteps: resolvedRun.totalSteps,
      completedStepsBefore: resolvedRun.completedStepsBefore,
      pendingSteps: Math.max(resolvedRun.totalSteps - resolvedRun.completedStepsBefore, 0),
    });

    runLogger.debug('computed:plan', {
      baseId: effectivePlan.baseId.toString(),
      seedTableId: effectivePlan.seedTableId.toString(),
      changeType: effectivePlan.changeType,
      seedRecordIds: effectivePlan.seedRecordIds.map((r) => r.toString()),
      steps: effectivePlan.steps.map((s) => ({
        tableId: s.tableId.toString(),
        level: s.level,
        fieldIds: s.fieldIds.map((f) => f.toString()),
      })),
      edges: effectivePlan.edges.map((e) => ({
        from: `${e.fromTableId.toString()}.${e.fromFieldId.toString()}`,
        to: `${e.toTableId.toString()}.${e.toFieldId.toString()}`,
        linkFieldId: e.linkFieldId?.toString(),
        propagationMode: e.propagationMode,
        allTargetRecordsReasons: e.allTargetRecordsReasons,
        order: e.order,
      })),
      plannedAllTargetReasonCounts,
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

    const collectChanges = options?.collectChanges ?? false;
    let currentPhase: 'prepare_dirty_state' | 'execute_prepared_steps' = 'prepare_dirty_state';

    const runWork = async () =>
      safeTry<ComputedUpdateResult, DomainError>(
        async function* (this: ComputedFieldUpdater) {
          currentPhase = 'prepare_dirty_state';
          const prepared = yield* await this.prepareDirtyState(effectivePlan, context);
          mainSpan?.setAttribute('computed.totalDirtyRecords', prepared.totalDirtyRecords);
          mainSpan?.setAttribute('computed.affectedTableCount', prepared.dirtyStats.length);
          const runtimeFallbackCount = countAllTargetReasonOccurrences(
            prepared.propagationStats.runtimeAllTargetFallbackReasonCounts
          );
          const runtimeFallbackSummary = summarizeAllTargetReasonCounts(
            prepared.propagationStats.runtimeAllTargetFallbackReasonCounts
          );
          mainSpan?.setAttribute('computed.runtimeAllTargetFallbackCount', runtimeFallbackCount);
          if (runtimeFallbackSummary) {
            mainSpan?.setAttribute(
              'computed.runtimeAllTargetFallbackReasons',
              runtimeFallbackSummary
            );
          }

          runLogger.debug('computed:dirtyStats', {
            totalDirtyRecords: prepared.totalDirtyRecords,
            affectedTables: prepared.dirtyStats,
            propagationStats: prepared.propagationStats,
          });

          currentPhase = 'execute_prepared_steps';
          const stepsResult = yield* await this.executePreparedSteps(
            effectivePlan,
            context,
            prepared,
            effectivePlan.steps,
            resolvedRun,
            collectChanges
          );
          mainSpan?.setAttribute('computed.executedStepCount', stepsResult.traceInfos.length);

          const completedSteps = resolvedRun.completedStepsBefore + stepsResult.traceInfos.length;
          runLogger.info('computed:run:done', {
            completedSteps,
            pendingSteps: Math.max(resolvedRun.totalSteps - completedSteps, 0),
            durationMs: Date.now() - runStartTime,
          });

          return ok({ changesByStep: stepsResult.changesByStep });
        }.bind(this)
      );

    try {
      const result =
        mainSpan && context.tracer
          ? await context.tracer.withSpan(mainSpan, runWork)
          : await runWork();

      if (result.isErr()) {
        runLogger.error('computed:run:failed', {
          phase: currentPhase,
          durationMs: Date.now() - runStartTime,
          totalSteps: resolvedRun.totalSteps,
          completedStepsBefore: resolvedRun.completedStepsBefore,
          pendingSteps: Math.max(resolvedRun.totalSteps - resolvedRun.completedStepsBefore, 0),
          ...toErrorLogFields(result.error),
        });
      }

      return result;
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
    const waitForLocks = options?.wait ?? true;
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
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      try {
        for (const statement of lockPlan.statements) {
          if (waitForLocks) {
            await db.executeQuery(buildAdvisoryLockQuery(db, statement.key));
            continue;
          }

          const result = await db.executeQuery(buildTryAdvisoryLockQuery(db, statement.key));
          if (!result.rows[0]?.locked) {
            return err(
              domainError.infrastructure({
                code: COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE,
                message: `Computed update lock unavailable: ${statement.key}`,
                details: {
                  lockKey: statement.key,
                  lockScope: statement.scope,
                  lockTableId: statement.tableId,
                  lockBatchId: statement.batchId,
                  lockRecordId: statement.recordId,
                },
              })
            );
          }
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
    const noSeedInput = plan.seedRecordIds.length === 0 && plan.extraSeedRecords.length === 0;
    const shouldSeedAllForSchemaUpdate = noSeedInput && plan.changeType === 'update';
    if (plan.steps.length === 0 || (noSeedInput && !shouldSeedAllForSchemaUpdate)) {
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      return ok({
        db,
        tableById: new Map(),
        dirtyStats: [],
        totalDirtyRecords: 0,
        propagationStats: emptyDirtyPropagationStats(),
      });
    }

    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;

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
        yield* await runWithSpan('teable.ComputedFieldUpdater.resetBeforeImageTable', () =>
          resetBeforeImageTable(db)
        );

        // Seed dirty records - wrap with span
        yield* await runWithSpan(
          'teable.ComputedFieldUpdater.seedDirtyRecords',
          async () => {
            if (noSeedInput && shouldSeedAllForSchemaUpdate) {
              const seedTable = tableById.get(plan.seedTableId.toString());
              if (!seedTable) {
                return err(
                  domainError.notFound({
                    message: `Missing seed table for full dirty seeding: ${plan.seedTableId.toString()}`,
                  })
                );
              }
              return seedAllDirtyRecordsForTable(db, seedTable);
            }

            // Seed "all records" tables via efficient SQL (skip individual record IDs)
            for (const tableId of plan.seedAllTableIds ?? []) {
              const table = tableById.get(tableId.toString());
              if (!table) {
                return err(
                  domainError.notFound({
                    message: `Missing table for seed-all dirty seeding: ${tableId.toString()}`,
                  })
                );
              }
              const result = await seedAllDirtyRecordsForTable(db, table);
              if (result.isErr()) return result;
            }

            // Seed individual records for remaining tables
            if (plan.seedRecordIds.length > 0) {
              const seedResult = await seedDirtyRecords(db, plan.seedTableId, plan.seedRecordIds);
              if (seedResult.isErr()) return seedResult;
            }
            return seedExtraDirtyRecords(db, plan.extraSeedRecords);
          },
          {
            seedCount: plan.seedRecordIds.length,
            extraSeedCount: plan.extraSeedRecords.length,
            seedAllTableCount: plan.seedAllTableIds?.length ?? 0,
          }
        );
        yield* await runWithSpan(
          'teable.ComputedFieldUpdater.seedBeforeImageRecords',
          () => seedBeforeImageRecords(db, plan.seedTableId, plan.beforeImageRecords ?? []),
          {
            beforeImageCount: (plan.beforeImageRecords ?? []).length,
          }
        );

        // Propagate dirty records - wrap with span so propagateEdge spans are children
        const propagationStats = (yield* await runWithSpan(
          'teable.ComputedFieldUpdater.propagateDirtyRecords',
          () => propagateDirtyRecords(db, plan.edges, tableById, context),
          { 'propagate.edgeCount': plan.edges.length }
        )) as DirtyPropagationStats;

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
          propagationStats,
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
    run?: ComputedUpdateRunContext,
    collectChanges: boolean = false
  ): Promise<Result<ExecutePreparedStepsResult, DomainError>> {
    if (steps.length === 0) return ok({ traceInfos: [], changesByStep: [] });

    const updateBuilder = new UpdateFromSelectBuilder(prepared.db);
    const stepTraces: StepTraceInfo[] = [];
    const changesByStep: StepChangeData[] = [];
    const runLogger = run ? this.logger.child(toRunLogContext(run)) : this.logger;

    // If we collapsed same-table batches into a single step, we still need the original
    // level structure to execute them correctly (CTE chain), and to avoid volatile formula
    // re-evaluation caused by formula expansion.
    const collapsedBatchByStepKey = (() => {
      const keysInSteps = new Set(steps.map(stepKey));
      const map = new Map<string, SameTableBatch>();
      for (const batch of plan.sameTableBatches) {
        if (batch.steps.length <= 1) continue;
        const collapsedKey = `${batch.tableId.toString()}|${batch.minLevel}`;
        const originalKeysPresent = batch.steps.some((s) => {
          const key = stepKey(s);
          return key !== collapsedKey && keysInSteps.has(key);
        });
        if (originalKeysPresent) continue;

        if (keysInSteps.has(collapsedKey)) {
          map.set(collapsedKey, batch);
        }
      }
      return map;
    })();

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

      const executeLevel = async (): Promise<Result<StepExecutionResult[], DomainError>> => {
        const results: StepExecutionResult[] = [];
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
            collapsedBatchByStepKey.get(stepKey(step)),
            prepared.tableById,
            context,
            index,
            run,
            doneSteps,
            pendingSteps,
            collectChanges
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

      let levelResults: Result<StepExecutionResult[], DomainError>;
      if (levelSpan && context.tracer) {
        levelResults = await context.tracer.withSpan(levelSpan, executeLevel);
      } else {
        levelResults = await executeLevel();
      }
      levelSpan?.end();

      if (levelResults.isErr()) {
        return err(levelResults.error);
      }

      for (const result of levelResults.value) {
        stepTraces.push(result.traceInfo);
        if (result.recordChanges.length > 0) {
          changesByStep.push({
            tableId: result.traceInfo.tableId,
            recordChanges: result.recordChanges,
          });
        }
      }
    }
    return ok({ traceInfos: stepTraces, changesByStep });
  }

  /**
   * Execute a single update step with tracing.
   */
  private async executeStep(
    db: Kysely<DynamicDB>,
    updateBuilder: UpdateFromSelectBuilder,
    step: UpdateStep,
    collapsedBatch: SameTableBatch | undefined,
    tableById: Map<string, Table>,
    context: IExecutionContext,
    stepIndex: number,
    run?: ComputedUpdateRunContext,
    doneSteps?: number,
    pendingSteps?: number,
    collectChanges: boolean = false
  ): Promise<Result<StepExecutionResult, DomainError>> {
    const table = tableById.get(step.tableId.toString());
    if (!table) {
      return err(
        domainError.notFound({
          message: `Missing table for computed update: ${step.tableId.toString()}`,
        })
      );
    }
    const tableName = table
      .dbTableName()
      .andThen((n) => n.value())
      .unwrapOr(step.tableId.toString());

    const fieldIds: FieldId[] = [];
    for (const fieldId of step.fieldIds) {
      const fieldResult = table.getField((f) => f.id().equals(fieldId));
      if (fieldResult.isErr()) {
        // Keep it - we can't determine generated-ness without the field.
        fieldIds.push(fieldId);
        continue;
      }

      const persistedAsGenerated = isPersistedAsGeneratedColumn(fieldResult.value);
      if (persistedAsGenerated.isErr()) return err(persistedAsGenerated.error);
      if (!persistedAsGenerated.value) fieldIds.push(fieldId);
    }

    // Collect field names for tracing
    const fieldNames: string[] = [];
    for (const fieldId of fieldIds) {
      const fieldResult = table.getField((f) => f.id().equals(fieldId));
      if (fieldResult.isOk()) {
        fieldNames.push(fieldResult.value.name().toString());
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
      'step.fieldCount': fieldIds.length,
      // Table info
      'step.tableId': step.tableId.toString(),
      'step.tableName': tableName,
      // Field info (both IDs and names for readability)
      'step.fieldIds': fieldIds.map((f) => f.toString()).join(','),
      'step.fieldNames': fieldNames.join(','),
      // Dirty record info
      'step.dirtyRecordCount': dirtyCount,
    });

    if (run) {
      stepSpan?.setAttributes(toRunSpanAttributes(run));
      if (doneSteps !== undefined) stepSpan?.setAttribute('step.position', doneSteps);
      if (pendingSteps !== undefined) stepSpan?.setAttribute('step.pending', pendingSteps);
    }

    const executeStepWork = async (): Promise<Result<StepExecutionResult, DomainError>> => {
      return safeTry<StepExecutionResult, DomainError>(
        async function* (this: ComputedFieldUpdater) {
          if (fieldIds.length === 0) {
            // Nothing to update (all fields are generated columns).
            return ok({
              traceInfo: {
                tableId: step.tableId.toString(),
                tableName,
                level: step.level,
                fieldIds: [],
                fieldNames: [],
                sql: '',
                parameterCount: 0,
                dirtyRecordCount: dirtyCount,
              },
              recordChanges: [],
            });
          }

          let selectQueries: QB[] | undefined;

          // If this step represents a collapsed same-table formula chain, execute using a CTE chain
          // so later formulas read the computed values of earlier formulas (and avoid volatile
          // re-evaluation caused by formula expansion).
          if (collapsedBatch && fieldIds.length > 1) {
            const hasJsonTargets = await this.hasJsonTargetColumns(db, tableName, table, fieldIds);
            if (hasJsonTargets) {
              stepSpan?.setAttribute('step.sameTableCollapsedSkipped', true);
              stepSpan?.setAttribute('step.sameTableCollapsedSkipReason', 'json_target_column');
            }

            if (!hasJsonTargets) {
              const fieldLevelsResult = safeTry<SameTableFieldLevel[], DomainError>(function* () {
                if (!collapsedBatch.tableId.equals(step.tableId)) {
                  return err(domainError.validation({ message: 'Collapsed batch table mismatch' }));
                }

                const allowedFieldIds = new Set(fieldIds.map((id) => id.toString()));
                const orderedBatchSteps = [...collapsedBatch.steps].sort(
                  (a, b) => a.level - b.level
                );
                const fieldLevels: SameTableFieldLevel[] = [];

                for (const batchStep of orderedBatchSteps) {
                  const levelFieldIds: FieldId[] = [];
                  for (const fieldId of batchStep.fieldIds) {
                    if (!allowedFieldIds.has(fieldId.toString())) continue;
                    const field = yield* table.getField((f) => f.id().equals(fieldId));
                    if (!field.type().equals(FieldType.formula())) {
                      return err(
                        domainError.validation({
                          message: 'Same-table batch optimization only supports formula fields',
                        })
                      );
                    }
                    levelFieldIds.push(fieldId);
                  }
                  if (levelFieldIds.length > 0) {
                    fieldLevels.push({ level: batchStep.level, fieldIds: levelFieldIds });
                  }
                }

                return ok(fieldLevels);
              });

              if (fieldLevelsResult.isErr()) return err(fieldLevelsResult.error);

              // If the batch no longer spans multiple effective levels after filtering, fall back.
              if (fieldLevelsResult.value.length > 1) {
                const batchBuilder = new SameTableBatchQueryBuilder(
                  db,
                  this.typeValidationStrategy
                );
                const chunkedRecordIds =
                  dirtyCount > SAME_TABLE_BATCH_CHUNK_TRIGGER
                    ? await this.getDirtyRecordIdChunks(db, step.tableId)
                    : [];
                const effectiveChunks =
                  chunkedRecordIds.length > 1 ? chunkedRecordIds : [undefined];

                stepSpan?.setAttribute('step.sameTableChunkCount', effectiveChunks.length);
                stepSpan?.setAttribute('step.sameTableChunked', effectiveChunks.length > 1);

                const batchSelectQueries: QB[] = [];
                for (const recordIds of effectiveChunks) {
                  const batchResult = yield* batchBuilder.build({
                    table,
                    fieldLevels: fieldLevelsResult.value,
                    ...(recordIds ? { recordIds } : {}),
                    dirtyFilter: {
                      tableId: step.tableId.toString(),
                      dirtyTableName: DIRTY_TABLE,
                      tableIdColumn: DIRTY_TABLE_ID_COL,
                      recordIdColumn: DIRTY_RECORD_ID_COL,
                    },
                  });
                  batchSelectQueries.push(batchResult.selectQuery);
                }
                selectQueries = batchSelectQueries;
              }
            }
          }

          if (!selectQueries) {
            const builder = new ComputedTableRecordQueryBuilder(db, {
              typeValidationStrategy: this.typeValidationStrategy,
              forceLookupArrayOutput: true,
            })
              .from(table)
              .select(fieldIds)
              .withDirtyFilter({ tableId: step.tableId.toString() });
            yield* await builder.prepare({
              context,
              tableRepository: this.tableRepository,
            });
            selectQueries = [yield* builder.build()];
          }

          const recordChanges: RecordChangeData[] = [];
          const executedSqls: Array<{ sql: string; parameterCount: number }> = [];

          if (collectChanges) {
            for (let i = 0; i < selectQueries.length; i++) {
              const selectQuery = selectQueries[i];
              const compiledResult = yield* updateBuilder.buildWithReturning({
                table,
                fieldIds,
                selectQuery,
              });
              executedSqls.push({
                sql: compiledResult.compiled.sql,
                parameterCount: compiledResult.compiled.parameters.length,
              });

              const chunkSuffix =
                selectQueries.length > 1 ? `:chunk=${i + 1}/${selectQueries.length}` : '';
              const sqlLogContext = run
                ? { ...toRunLogContext(run), parameters: compiledResult.compiled.parameters }
                : { parameters: compiledResult.compiled.parameters };
              this.logger.debug(
                `computed:update:table=${tableName}:level=${step.level}${chunkSuffix}:sql:\n${compiledResult.compiled.sql}`,
                sqlLogContext
              );

              const result = await db.executeQuery(compiledResult.compiled);
              const rows = (result.rows ?? []) as UpdatedRecordRow[];

              // Build change data from returned rows
              for (const row of rows) {
                const changes: FieldChangeData[] = [];
                for (const [column, fieldId] of compiledResult.columnToFieldId) {
                  changes.push({
                    fieldId,
                    newValue: row[column],
                  });
                }
                recordChanges.push({
                  recordId: row.__id,
                  oldVersion: row.__old_version,
                  changes,
                });
              }
            }

            const sqlSummary =
              executedSqls.length > 1
                ? `[chunked:${executedSqls.length}] ${executedSqls[0]?.sql ?? ''}`
                : executedSqls[0]?.sql ?? '';
            const parameterCount = executedSqls.reduce((sum, item) => sum + item.parameterCount, 0);

            // Record SQL on span
            stepSpan?.setAttribute('step.sql', sqlSummary);
            stepSpan?.setAttribute('step.parameterCount', parameterCount);

            const traceInfo: StepTraceInfo = {
              tableId: step.tableId.toString(),
              tableName,
              level: step.level,
              fieldIds: fieldIds.map((f) => f.toString()),
              fieldNames,
              sql: sqlSummary,
              parameterCount,
              dirtyRecordCount: dirtyCount,
            };

            return ok({ traceInfo, recordChanges });
          }

          for (let i = 0; i < selectQueries.length; i++) {
            const selectQuery = selectQueries[i];
            const compiled = yield* updateBuilder.build({
              table,
              fieldIds,
              selectQuery,
              // Note: dirtyFilter is applied on the ComputedTableRecordQueryBuilder above
              // This ensures the dirty JOIN is placed BEFORE lateral joins for optimal query planning
            });
            executedSqls.push({
              sql: compiled.sql,
              parameterCount: compiled.parameters.length,
            });

            const chunkSuffix =
              selectQueries.length > 1 ? `:chunk=${i + 1}/${selectQueries.length}` : '';
            const sqlLogContext = run
              ? { ...toRunLogContext(run), parameters: compiled.parameters }
              : { parameters: compiled.parameters };
            this.logger.debug(
              `computed:update:table=${tableName}:level=${step.level}${chunkSuffix}:sql:\n${compiled.sql}`,
              sqlLogContext
            );

            await db.executeQuery(compiled);
          }

          const sqlSummary =
            executedSqls.length > 1
              ? `[chunked:${executedSqls.length}] ${executedSqls[0]?.sql ?? ''}`
              : executedSqls[0]?.sql ?? '';
          const parameterCount = executedSqls.reduce((sum, item) => sum + item.parameterCount, 0);

          // Record SQL on span
          stepSpan?.setAttribute('step.sql', sqlSummary);
          stepSpan?.setAttribute('step.parameterCount', parameterCount);

          const traceInfo: StepTraceInfo = {
            tableId: step.tableId.toString(),
            tableName,
            level: step.level,
            fieldIds: fieldIds.map((f) => f.toString()),
            fieldNames,
            sql: sqlSummary,
            parameterCount,
            dirtyRecordCount: dirtyCount,
          };

          return ok({ traceInfo, recordChanges });
        }.bind(this)
      );
    };

    try {
      // Use withSpan to set stepSpan as active context so pg queries become children
      if (stepSpan && context.tracer) {
        return await context.tracer.withSpan(stepSpan, executeStepWork);
      }
      return await executeStepWork();
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

    const executeBatchWork = async (): Promise<Result<StepTraceInfo[], DomainError>> => {
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
          undefined,
          prepared.tableById,
          context,
          i,
          run,
          undefined,
          undefined,
          false // collectChanges not supported for batch execution yet
        );
        if (result.isErr()) return err(result.error);
        traces.push(result.value.traceInfo);
      }

      return ok(traces);
    };

    try {
      // Use withSpan to set batchSpan as active context so pg queries become children
      if (batchSpan && context.tracer) {
        return await context.tracer.withSpan(batchSpan, executeBatchWork);
      }
      return await executeBatchWork();
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

  private async hasJsonTargetColumns(
    db: Kysely<DynamicDB>,
    tableName: string,
    table: Table,
    fieldIds: ReadonlyArray<FieldId>
  ): Promise<boolean> {
    try {
      const tableNameParts = tableName.split('.');
      if (tableNameParts.length !== 2) return false;
      const [schemaName, physicalTableName] = tableNameParts;

      const columnNames: string[] = [];
      for (const fieldId of fieldIds) {
        const fieldResult = table.getField((f) => f.id().equals(fieldId));
        if (fieldResult.isErr()) continue;
        const dbFieldNameResult = fieldResult.value.dbFieldName().andThen((n) => n.value());
        if (dbFieldNameResult.isErr()) continue;
        columnNames.push(dbFieldNameResult.value);
      }

      if (columnNames.length === 0) return false;

      const columns = await db
        .selectFrom('information_schema.columns')
        .select(['column_name', 'data_type', 'udt_name'])
        .where('table_schema', '=', schemaName)
        .where('table_name', '=', physicalTableName)
        .where('column_name', 'in', columnNames)
        .execute();

      return columns.some((column) => {
        const dataType = String(column.data_type).toLowerCase();
        const udtName = String(column.udt_name).toLowerCase();
        return (
          dataType === 'json' || dataType === 'jsonb' || udtName === 'json' || udtName === 'jsonb'
        );
      });
    } catch {
      return false;
    }
  }

  private async getDirtyRecordIdChunks(
    db: Kysely<DynamicDB>,
    tableId: TableId
  ): Promise<ReadonlyArray<ReadonlyArray<string>>> {
    const recordIds = await this.getDirtyRecordIdsForTable(db, tableId);
    if (recordIds.length === 0) return [];
    return splitIntoChunks(recordIds, SAME_TABLE_BATCH_CHUNK_SIZE);
  }

  private async getDirtyRecordIdsForTable(
    db: Kysely<DynamicDB>,
    tableId: TableId
  ): Promise<string[]> {
    try {
      const rows = await db
        .selectFrom(DIRTY_TABLE)
        .select(DIRTY_RECORD_ID_COL)
        .where(DIRTY_TABLE_ID_COL, '=', tableId.toString())
        .orderBy(DIRTY_RECORD_ID_COL)
        .execute();

      const recordIds: string[] = [];
      for (const row of rows as Array<Record<string, unknown>>) {
        const value = row[DIRTY_RECORD_ID_COL];
        if (typeof value === 'string') {
          recordIds.push(value);
        } else if (value != null) {
          recordIds.push(String(value));
        }
      }
      return recordIds;
    } catch {
      return [];
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
  ): Promise<Result<{ groups: ComputedSeedGroup[]; seedAllTableIds: TableId[] }, DomainError>> {
    const uniqueTableIds = [...new Set(tableIds.map((id) => id.toString()))];
    if (uniqueTableIds.length === 0) return ok({ groups: [], seedAllTableIds: [] });

    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
    try {
      const tableIdMap = new Map<string, TableId>();
      for (const tableId of tableIds) {
        tableIdMap.set(tableId.toString(), tableId);
      }

      // Count dirty records per table to identify "seed all" tables
      const counts = await db
        .selectFrom(DIRTY_TABLE)
        .select([
          sql.ref(DIRTY_TABLE_ID_COL).as('tableId'),
          sql<number>`count(${sql.ref(DIRTY_RECORD_ID_COL)})`.as('cnt'),
        ])
        .where(DIRTY_TABLE_ID_COL, 'in', uniqueTableIds)
        .groupBy(DIRTY_TABLE_ID_COL)
        .execute();

      const SEED_ALL_THRESHOLD = 5000;
      const seedAllTableIds: TableId[] = [];
      const normalTableIds: string[] = [];

      for (const row of counts) {
        const tableIdStr = String(row.tableId);
        const count = Number(row.cnt);
        if (count >= SEED_ALL_THRESHOLD) {
          const existing = tableIdMap.get(tableIdStr);
          if (existing) {
            seedAllTableIds.push(existing);
          } else {
            const result = TableId.create(tableIdStr);
            if (result.isErr()) return err(result.error);
            seedAllTableIds.push(result.value);
          }
        } else {
          normalTableIds.push(tableIdStr);
        }
      }

      // Only fetch individual IDs for tables below the threshold
      const groups = new Map<string, { tableId: TableId; recordIds: RecordId[] }>();
      if (normalTableIds.length > 0) {
        const rows = await db
          .selectFrom(DIRTY_TABLE)
          .select([
            sql.ref(DIRTY_TABLE_ID_COL).as('tableId'),
            sql.ref(DIRTY_RECORD_ID_COL).as('recordId'),
          ])
          .where(DIRTY_TABLE_ID_COL, 'in', normalTableIds)
          .execute();

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
      }

      return ok({ groups: [...groups.values()], seedAllTableIds });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to collect dirty record ids: ${describeError(error)}`,
        })
      );
    }
  }
}

const splitIntoChunks = <T>(values: ReadonlyArray<T>, chunkSize: number): T[][] => {
  if (values.length === 0) return [];
  if (chunkSize <= 0 || values.length <= chunkSize) return [Array.from(values)];

  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(Array.from(values.slice(i, i + chunkSize)));
  }
  return chunks;
};

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

const resetBeforeImageTable = async (db: Kysely<DynamicDB>): Promise<Result<void, DomainError>> => {
  try {
    await db.executeQuery(sql`drop table if exists ${sql.table(BEFORE_IMAGE_TABLE)}`.compile(db));
    await db.executeQuery(
      sql`create temporary table ${sql.table(BEFORE_IMAGE_TABLE)} (
        ${sql.raw(DIRTY_TABLE_ID_COL)} text not null,
        ${sql.raw(DIRTY_RECORD_ID_COL)} text not null,
        ${sql.raw(BEFORE_IMAGE_SNAPSHOT_COL)} jsonb not null,
        primary key (${sql.raw(DIRTY_TABLE_ID_COL)}, ${sql.raw(DIRTY_RECORD_ID_COL)})
      ) on commit drop`.compile(db)
    );
    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to create before-image table: ${describeError(error)}`,
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

const seedAllDirtyRecordsForTable = async (
  db: Kysely<DynamicDB>,
  table: Table
): Promise<Result<void, DomainError>> => {
  const tableNameResult = table.dbTableName().andThen((dbTableName) => dbTableName.value());
  if (tableNameResult.isErr()) return err(tableNameResult.error);

  try {
    await db
      .insertInto(DIRTY_TABLE)
      .columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL])
      .expression(
        db
          .selectFrom(tableNameResult.value as keyof DynamicDB)
          .select([
            sql.lit(table.id().toString()).as(DIRTY_TABLE_ID_COL),
            sql.ref('__id').as(DIRTY_RECORD_ID_COL),
          ])
      )
      .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
      .execute();
    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to seed all dirty records: ${describeError(error)}`,
      })
    );
  }
};

const seedBeforeImageRecords = async (
  db: Kysely<DynamicDB>,
  tableId: TableId,
  beforeImageRecords: ReadonlyArray<{
    recordId: RecordId;
    fieldValuesByDbName: Readonly<Record<string, unknown>>;
  }>
): Promise<Result<void, DomainError>> => {
  if (beforeImageRecords.length === 0) {
    return ok(undefined);
  }

  try {
    const values = beforeImageRecords.map((record) => ({
      [DIRTY_TABLE_ID_COL]: tableId.toString(),
      [DIRTY_RECORD_ID_COL]: record.recordId.toString(),
      [BEFORE_IMAGE_SNAPSHOT_COL]: JSON.stringify(record.fieldValuesByDbName),
    }));
    const batchSize = 500;
    for (let i = 0; i < values.length; i += batchSize) {
      await db
        .insertInto(BEFORE_IMAGE_TABLE)
        .values(values.slice(i, i + batchSize))
        .onConflict((oc) =>
          oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doUpdateSet({
            [BEFORE_IMAGE_SNAPSHOT_COL]: sql.ref(`excluded.${BEFORE_IMAGE_SNAPSHOT_COL}`),
          })
        )
        .execute();
    }
    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to seed before-image records: ${describeError(error)}`,
      })
    );
  }
};

/**
 * Information about an edge for tracing purposes.
 */
interface EdgeTraceInfo {
  index: number;
  edge: ComputedDependencyEdge;
  sourceTableName: string;
  targetTableName: string;
  fromFieldName: string;
  toFieldName: string;
  linkFieldName: string;
}

/**
 * Build trace info for an edge.
 */
const buildEdgeTraceInfo = (
  edge: ComputedDependencyEdge,
  index: number,
  tableById: Map<string, Table>
): EdgeTraceInfo => {
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

  return {
    index,
    edge,
    sourceTableName,
    targetTableName,
    fromFieldName,
    toFieldName,
    linkFieldName,
  };
};

type DirtySelectQuery = QB;

type BuiltPropagationSelect = {
  query: DirtySelectQuery;
  runtimeAllTargetFallbackReason?: AllTargetRecordsReason;
};

type PreparedPropagationSelect = {
  query: DirtySelectQuery;
  traceInfos: EdgeTraceInfo[];
};

const propagationQueryKey = (compiled: ReturnType<DirtySelectQuery['compile']>): string =>
  `${compiled.sql}::${JSON.stringify(compiled.parameters)}`;

const toAffectedRowCount = (value: unknown): number | undefined => {
  if (typeof value === 'bigint') {
    return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
  }
  if (typeof value === 'number') return value;
  return undefined;
};

const propagateDirtyRecords = async (
  db: Kysely<DynamicDB>,
  edges: ReadonlyArray<ComputedDependencyEdge>,
  tableById: Map<string, Table>,
  context?: IExecutionContext
): Promise<Result<DirtyPropagationStats, DomainError>> => {
  try {
    // Build trace info for all edges once
    const edgeTraceInfos = edges.map((edge, i) => buildEdgeTraceInfo(edge, i, tableById));
    const plannedAllTargetReasonCounts = countPlannedAllTargetReasonCounts(edges);
    const plannedAllTargetReasonSummary = summarizeAllTargetReasonCounts(
      plannedAllTargetReasonCounts
    );
    const runtimeAllTargetFallbackReasonCounts: AllTargetReasonCounts = {};

    // Multiple computed fields can share the same dirty-propagation path. Collapse
    // identical SELECTs up front so we don't emit repeated UNION ALL branches.
    const preparedQueries = new Map<string, PreparedPropagationSelect>();
    for (const traceInfo of edgeTraceInfos) {
      const selectResult = buildPropagationSelect(db, traceInfo.edge, tableById);
      if (selectResult.isErr()) {
        return err(selectResult.error);
      }

      incrementAllTargetReasonCount(
        runtimeAllTargetFallbackReasonCounts,
        selectResult.value.runtimeAllTargetFallbackReason
      );

      const compiled = selectResult.value.query.compile();
      const key = propagationQueryKey(compiled);
      const existing = preparedQueries.get(key);
      if (existing) {
        existing.traceInfos.push(traceInfo);
        continue;
      }

      preparedQueries.set(key, {
        query: selectResult.value.query,
        traceInfos: [traceInfo],
      });
    }

    const selectQueries = [...preparedQueries.values()];
    const maxPasses = Math.max(selectQueries.length, 1);

    for (let pass = 0; pass < maxPasses; pass += 1) {
      if (selectQueries.length === 0) {
        break;
      }

      // Create a single span for the batched propagation
      const batchSpan = context?.tracer?.startSpan(
        'teable.ComputedFieldUpdater.propagateDirtyBatch',
        {
          'batch.pass': pass,
          'batch.edgeCount': selectQueries.length,
          'batch.originalEdgeCount': edges.length,
          'batch.plannedAllTargetReasonCount': countAllTargetReasonOccurrences(
            plannedAllTargetReasonCounts
          ),
          'batch.runtimeAllTargetFallbackCount': countAllTargetReasonOccurrences(
            runtimeAllTargetFallbackReasonCounts
          ),
          'batch.edges': selectQueries
            .map((q) => {
              const labels = [
                ...new Set(
                  q.traceInfos.map(
                    (traceInfo) =>
                      `${traceInfo.sourceTableName}.${traceInfo.fromFieldName} → ${traceInfo.targetTableName}.${traceInfo.toFieldName}`
                  )
                ),
              ];
              return labels.length > 1
                ? `${labels[0]} (+${labels.length - 1} equivalent)`
                : labels[0];
            })
            .join('; '),
        }
      );
      if (plannedAllTargetReasonSummary) {
        batchSpan?.setAttribute('batch.plannedAllTargetReasons', plannedAllTargetReasonSummary);
      }
      const runtimeFallbackReasonSummary = summarizeAllTargetReasonCounts(
        runtimeAllTargetFallbackReasonCounts
      );
      if (runtimeFallbackReasonSummary) {
        batchSpan?.setAttribute(
          'batch.runtimeAllTargetFallbackReasons',
          runtimeFallbackReasonSummary
        );
      }

      const executeBatchWork = async (): Promise<number | undefined> => {
        // Build UNION ALL query from all SELECT queries
        if (selectQueries.length === 1) {
          // Single edge - no need for UNION ALL
          const compiled = db
            .insertInto(DIRTY_TABLE)
            .columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL])
            .expression(selectQueries[0].query)
            .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
            .compile();

          batchSpan?.setAttribute('batch.sql', compiled.sql);
          const result = await db.executeQuery(compiled);
          return toAffectedRowCount(result.numAffectedRows);
        } else {
          // Multiple edges - use UNION ALL
          // Start with first query, then chain unionAll for the rest
          let unionQuery = selectQueries[0].query;
          for (let i = 1; i < selectQueries.length; i++) {
            unionQuery = unionQuery.unionAll(selectQueries[i].query) as DirtySelectQuery;
          }

          const compiled = db
            .insertInto(DIRTY_TABLE)
            .columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL])
            .expression(unionQuery)
            .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
            .compile();

          batchSpan?.setAttribute('batch.sql', compiled.sql);
          const result = await db.executeQuery(compiled);
          return toAffectedRowCount(result.numAffectedRows);
        }
      };

      let insertedRowCount: number | undefined;
      try {
        // Use withSpan to set batchSpan as active context so pg queries become children
        if (batchSpan && context?.tracer) {
          insertedRowCount = await context.tracer.withSpan(batchSpan, executeBatchWork);
        } else {
          insertedRowCount = await executeBatchWork();
        }
      } finally {
        if (insertedRowCount !== undefined) {
          batchSpan?.setAttribute('batch.insertedRowCount', insertedRowCount);
        }
        batchSpan?.end();
      }

      if (insertedRowCount === 0) {
        break;
      }
    }
    return ok({
      plannedAllTargetReasonCounts,
      runtimeAllTargetFallbackReasonCounts,
    });
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to propagate dirty records: ${describeError(error)}`,
      })
    );
  }
};

type DirtySelectParams = {
  db: Kysely<DynamicDB>;
  relationship: LinkRelationship;
  linkField: LinkField;
  sourceTableName: string;
  targetTableName: string;
  sourceTableId: string;
  targetTableId: string;
};

const buildDirtySelectQuery = (
  params: DirtySelectParams
): Result<DirtySelectQuery, DomainError> => {
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
      const fkHostTableName = yield* linkField.fkHostTableNameString();
      const foreignKey = yield* linkField.foreignKeyNameString();
      const selfKey = yield* linkField.selfKeyNameString();

      // Check if target table hosts the FK
      if (fkHostTableName === targetTableName) {
        // Normal case: FK is on target table
        // Join target table with dirty table on foreignKey
        const select = db
          .selectFrom(`${targetTableName} as t`)
          .innerJoin(`${DIRTY_TABLE} as d`, `d.${DIRTY_RECORD_ID_COL}`, `t.${foreignKey}`)
          .where(`d.${DIRTY_TABLE_ID_COL}`, '=', sourceTableId)
          .select([
            sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
            sql.ref('t.__id').as(DIRTY_RECORD_ID_COL),
          ])
          .distinct();

        return ok(select as unknown as DirtySelectQuery);
      }

      // Symmetric case: FK is on source table (fkHostTable = sourceTable)
      // The link field is on the "foreign" side of the relationship.
      // Join source table with dirty table, select selfKey as target record
      // (selfKey points to the target table records via the FK in source table)
      const select = db
        .selectFrom(`${sourceTableName} as s`)
        .innerJoin(`${DIRTY_TABLE} as d`, `d.${DIRTY_RECORD_ID_COL}`, 's.__id')
        .where(`d.${DIRTY_TABLE_ID_COL}`, '=', sourceTableId)
        .where(sql.ref(`s.${selfKey}`), 'is not', null)
        .select([
          sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
          sql.ref(`s.${selfKey}`).as(DIRTY_RECORD_ID_COL),
        ])
        .distinct();

      return ok(select as unknown as DirtySelectQuery);
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

        return ok(select as unknown as DirtySelectQuery);
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

      return ok(select as unknown as DirtySelectQuery);
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

    return ok(select as unknown as DirtySelectQuery);
  });
};

const buildGatedAllTargetSelect = (
  db: Kysely<DynamicDB>,
  edge: Pick<ComputedDependencyEdge, 'fromTableId' | 'toTableId'>,
  targetDbName: string
): DirtySelectQuery => {
  const dirtyGate = db
    .selectFrom(`${DIRTY_TABLE} as d`)
    .select(sql.ref(`d.${DIRTY_TABLE_ID_COL}`).as(DIRTY_TABLE_ID_COL))
    .where(`d.${DIRTY_TABLE_ID_COL}`, '=', edge.fromTableId.toString())
    .limit(1)
    .as('dg');

  return db
    .selectFrom(`${targetDbName} as t`)
    .innerJoin(dirtyGate, (join) => join.onTrue())
    .select([
      sql.lit(edge.toTableId.toString()).as(DIRTY_TABLE_ID_COL),
      sql.ref('t.__id').as(DIRTY_RECORD_ID_COL),
    ])
    .distinct() as unknown as DirtySelectQuery;
};

/**
 * Build a SELECT query for dirty record propagation (without INSERT wrapper).
 * This allows combining multiple SELECT queries with UNION ALL.
 */
const buildPropagationSelect = (
  db: Kysely<DynamicDB>,
  edge: ComputedDependencyEdge,
  tableById: Map<string, Table>
): Result<BuiltPropagationSelect, DomainError> => {
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
      const isSelfRefresh =
        edge.fromTableId.equals(edge.toTableId) && edge.fromFieldId.equals(edge.toFieldId);

      const select = isSelfRefresh
        ? db
            .selectFrom(`${targetDbName} as t`)
            .select([
              sql.lit(edge.toTableId.toString()).as(DIRTY_TABLE_ID_COL),
              sql.ref('t.__id').as(DIRTY_RECORD_ID_COL),
            ])
            .distinct()
        : buildGatedAllTargetSelect(db, edge, targetDbName);

      return ok({ query: select as unknown as DirtySelectQuery });
    }

    // conditionalFiltered: Only mark target records as dirty if dirty source records match the filter
    if (edge.propagationMode === 'conditionalFiltered' && edge.filterCondition) {
      const sourceTable = tableById.get(edge.fromTableId.toString());
      if (!sourceTable) {
        return err(
          domainError.notFound({
            message: `Missing source table ${edge.fromTableId.toString()} for conditionalFiltered`,
          })
        );
      }

      // Create FieldCondition from filterDto
      const fieldConditionResult = FieldCondition.create({
        filter: edge.filterCondition.filterDto,
      });
      if (fieldConditionResult.isErr()) {
        // Fallback to allTargetRecords if filter is invalid
        const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());
        return ok({
          query: buildGatedAllTargetSelect(db, edge, targetDbName),
          runtimeAllTargetFallbackReason: 'conditional_runtime_invalid_filter',
        });
      }

      const fieldCondition = fieldConditionResult.value;
      if (!fieldCondition.hasFilter()) {
        // No filter - fallback to allTargetRecords
        const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());
        return ok({
          query: buildGatedAllTargetSelect(db, edge, targetDbName),
          runtimeAllTargetFallbackReason: 'conditional_runtime_empty_filter',
        });
      }

      // Convert to RecordConditionSpec
      // For conditional lookups with field references (isSymbol), pass targetTable as hostTable
      // so field references can be resolved from the host (target) table
      const conditionSpecResult = fieldCondition.toRecordConditionSpec(sourceTable, targetTable);
      if (conditionSpecResult.isErr()) {
        // Condition references a field that no longer exists (e.g., deleted field) -
        // fallback to allTargetRecords so the field can still be recalculated/cleared
        const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());
        return ok({
          query: buildGatedAllTargetSelect(db, edge, targetDbName),
          runtimeAllTargetFallbackReason: 'conditional_runtime_invalid_condition_spec',
        });
      }
      const specResult = conditionSpecResult.value;
      if (!specResult) {
        // No spec generated - fallback to allTargetRecords
        const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());
        return ok({
          query: buildGatedAllTargetSelect(db, edge, targetDbName),
          runtimeAllTargetFallbackReason: 'conditional_runtime_missing_condition_spec',
        });
      }

      const visitor = new TableRecordConditionWhereVisitor({
        tableAlias: 's',
        hostTableAlias: 't',
      });
      const acceptResult = specResult.accept(visitor);
      if (acceptResult.isErr()) {
        return err(acceptResult.error);
      }
      const whereResult = visitor.where();
      if (whereResult.isErr()) {
        return err(whereResult.error);
      }
      const filterWhere = whereResult.value as unknown as Expression<SqlBool>;

      const sourceDbName = yield* sourceTable.dbTableName().andThen((name) => name.value());
      const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());

      const currentMatchQuery = db
        .selectFrom(`${DIRTY_TABLE} as d`)
        .innerJoin(`${sourceDbName} as s`, 's.__id', `d.${DIRTY_RECORD_ID_COL}`)
        .select(sql.lit(1).as('one'))
        .where(`d.${DIRTY_TABLE_ID_COL}`, '=', edge.fromTableId.toString())
        .where(filterWhere)
        .limit(1);

      let matchCondition = sql<SqlBool>`exists (${currentMatchQuery})`;

      if (edge.filterCondition.includeBeforeImage) {
        const beforeImageVisitor = new TableRecordConditionWhereVisitor({
          tableAlias: 's_before',
          hostTableAlias: 't',
        });
        const beforeAcceptResult = specResult.accept(beforeImageVisitor);
        if (beforeAcceptResult.isErr()) {
          return err(beforeAcceptResult.error);
        }
        const beforeWhereResult = beforeImageVisitor.where();
        if (beforeWhereResult.isErr()) {
          return err(beforeWhereResult.error);
        }
        const beforeFilterWhere = beforeWhereResult.value as unknown as Expression<SqlBool>;
        const sourceTableTypeLiteral = toQualifiedIdentifierLiteral(sourceDbName);

        const beforeImageMatchQuery = db
          .selectFrom(`${DIRTY_TABLE} as d`)
          .innerJoin(`${BEFORE_IMAGE_TABLE} as bi`, (join) =>
            join
              .onRef(`bi.${DIRTY_TABLE_ID_COL}`, '=', `d.${DIRTY_TABLE_ID_COL}`)
              .onRef(`bi.${DIRTY_RECORD_ID_COL}`, '=', `d.${DIRTY_RECORD_ID_COL}`)
          )
          .leftJoin(`${sourceDbName} as s_current`, 's_current.__id', `d.${DIRTY_RECORD_ID_COL}`)
          .innerJoinLateral(
            sql<{ one: number }>`(
              select 1 as one
              -- Reconstruct the pre-change source row by starting from the current row
              -- (or an empty JSON object for DELETE) and overlaying the captured old column values.
              from jsonb_populate_record(
                null::${sql.raw(sourceTableTypeLiteral)},
                coalesce(to_jsonb(${sql.raw(quoteIdentifier('s_current'))}), '{}'::jsonb)
                  || ${sql.ref(`bi.${BEFORE_IMAGE_SNAPSHOT_COL}`)}
              ) as s_before
              where ${beforeFilterWhere}
              limit 1
            )`.as('sb'),
            (join) => join.onTrue()
          )
          .select(sql.lit(1).as('one'))
          .where(`d.${DIRTY_TABLE_ID_COL}`, '=', edge.fromTableId.toString())
          .limit(1);

        matchCondition = sql<SqlBool>`(${matchCondition}) or exists (${beforeImageMatchQuery})`;
      }

      const select = db
        .selectFrom(`${targetDbName} as t`)
        .select([
          sql.lit(edge.toTableId.toString()).as(DIRTY_TABLE_ID_COL),
          sql.ref('t.__id').as(DIRTY_RECORD_ID_COL),
        ])
        .where(matchCondition)
        .distinct();

      return ok({ query: select as unknown as DirtySelectQuery });
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

    const linkFieldResult = targetTable.getField((field): field is LinkField =>
      field.id().equals(edge.linkFieldId!)
    );
    if (linkFieldResult.isErr()) {
      // Schema updates/undo-redo may leave transient stale edges.
      // Skip them instead of failing the whole computed run.
      const select = db
        .selectFrom(DIRTY_TABLE)
        .select([
          sql.lit(edge.toTableId.toString()).as(DIRTY_TABLE_ID_COL),
          sql.ref(DIRTY_RECORD_ID_COL).as(DIRTY_RECORD_ID_COL),
        ])
        .where(sql<SqlBool>`false`);
      return ok({ query: select as unknown as DirtySelectQuery });
    }
    const linkField = linkFieldResult.value;

    if (!linkField.foreignTableId().equals(edge.fromTableId)) {
      const select = db
        .selectFrom(DIRTY_TABLE)
        .select([
          sql.lit(edge.toTableId.toString()).as(DIRTY_TABLE_ID_COL),
          sql.ref(DIRTY_RECORD_ID_COL).as(DIRTY_RECORD_ID_COL),
        ])
        .where(sql<SqlBool>`false`);
      return ok({ query: select as unknown as DirtySelectQuery });
    }

    const sourceDbName = yield* sourceTable.dbTableName().andThen((name) => name.value());
    const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());

    const relationship = linkField.relationship();
    const selectQuery = yield* buildDirtySelectQuery({
      db,
      relationship,
      linkField,
      sourceTableName: sourceDbName,
      targetTableName: targetDbName,
      sourceTableId: edge.fromTableId.toString(),
      targetTableId: edge.toTableId.toString(),
    });

    return ok({ query: selectQuery });
  });
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
