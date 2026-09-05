import {
  getPostgresTransaction,
  PostgresSqlExecutionError,
  resolvePostgresDbOrTx,
} from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  tableDataSafetyLimitErrors,
  FieldType,
  FieldCondition,
  LinkRelationship,
  measureJsonBytes,
  RecordId,
  resolveTableDataSafetyLimits,
  TableDataSafetyLimitComposer,
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
import type { CompiledQuery, Expression, Kysely, SqlBool } from 'kysely';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { resolveColumnType } from '../../schema/visitors/PostgresTableSchemaFieldColumn';
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
  cleanupChangeFrontierOrphans,
  clearChangeFrontier,
  recordStageValueChanges,
} from './ComputedChangeFrontier';
import {
  STAGE_LEDGER_TABLE,
  type ComputedStageLedgerSettlementMode,
  appendStageLedgerPartialBatch,
  clearStageLedger,
  collectStageOutputSeedGroups,
  pushStageLedgerFrontierHead,
  retireStageLedgerFrontierHead,
  stageLedgerHasFrontier,
  seedStageLedgerFrontierHead,
} from './ComputedStageLedger';
import {
  COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE,
  type ComputedUpdateLockConfig,
  type ComputedUpdateLockStatement,
  type ComputedUpdateLockSummary,
  buildAdvisoryLockBatchQuery,
  buildAdvisoryLockQuery,
  buildComputedUpdateLockPlan,
  buildSharedAdvisoryLockQuery,
  buildTryAdvisoryLockBatchQuery,
  buildTryAdvisoryLockQuery,
  buildTrySharedAdvisoryLockQuery,
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
import { pushAll } from './pushAll';
import { UpdateFromSelectBuilder } from './UpdateFromSelectBuilder';
import type { UpdatedRecordRow } from './UpdateFromSelectBuilder';

const DIRTY_TABLE = 'pg_temp.tmp_computed_dirty';
const DIRTY_TABLE_ID_COL = 'table_id';
const DIRTY_RECORD_ID_COL = 'record_id';
const DIRTY_GENERATION_COL = 'generation';
const BEFORE_IMAGE_TABLE = 'pg_temp.tmp_computed_before_image';
const BEFORE_IMAGE_SNAPSHOT_COL = 'field_values';
const SAME_TABLE_BATCH_CHUNK_TRIGGER = 1000;
/** Dirty-count threshold above which a table collects as seed-all instead of ids. */
const DEFAULT_SEED_ALL_THRESHOLD = 5000;
const SAME_TABLE_BATCH_CHUNK_SIZE = 500;
const JSON_SAME_TABLE_BATCH_CHUNK_SIZE = 25;
const COMPUTED_UPDATE_FIELD_CHUNK_SIZE = 16;
const DISTINCT_HOST_KEY_UNCHUNK_MAX_DIRTY_RECORDS = 50_000;
const DISTINCT_HOST_KEY_UNCHUNK_MAX_KEYS = 5_000;

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

type ComputedUpdateQueryPlan = {
  selectQuery: QB;
  fieldIds: ReadonlyArray<FieldId>;
};

const chunkArray = <T>(items: ReadonlyArray<T>, size: number): ReadonlyArray<ReadonlyArray<T>> => {
  if (items.length <= size) return [items];

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const mergeRecordChanges = (
  target: Map<string, RecordChangeData>,
  changes: ReadonlyArray<RecordChangeData>
): void => {
  for (const change of changes) {
    const existing = target.get(change.recordId);
    if (!existing) {
      target.set(change.recordId, {
        recordId: change.recordId,
        oldVersion: change.oldVersion,
        changes: [...change.changes],
      });
      continue;
    }

    target.set(change.recordId, {
      recordId: change.recordId,
      oldVersion: Math.min(existing.oldVersion, change.oldVersion),
      changes: [...existing.changes, ...change.changes],
    });
  }
};

const encodeRevertValue = (rejection: ComputedCellLimitRejection): unknown => {
  if (rejection.oldValue === undefined || rejection.oldValue === null) return null;
  // node-pg serializes JS arrays as Postgres array literals and strings as
  // bare text — neither is valid jsonb input, so jsonb old values must be
  // JSON-encoded before binding (see FieldInsertValueVisitor for the same rule).
  return rejection.columnType === 'jsonb' ? JSON.stringify(rejection.oldValue) : rejection.oldValue;
};

const stripRejectedFieldChanges = (
  recordChanges: RecordChangeData[],
  rejections: ReadonlyArray<ComputedCellLimitRejection>
): void => {
  const rejectedKeys = new Set(
    rejections.map((rejection) => `${rejection.recordId}|${rejection.fieldId}`)
  );
  for (let index = recordChanges.length - 1; index >= 0; index -= 1) {
    const record = recordChanges[index];
    if (!record) continue;
    const changes = record.changes.filter(
      (change) => !rejectedKeys.has(`${record.recordId}|${change.fieldId}`)
    );
    if (changes.length === 0) {
      recordChanges.splice(index, 1);
      continue;
    }
    recordChanges[index] = { ...record, changes };
  }
};
/**
 * Change data for a single field in a record.
 */
export type FieldChangeData = {
  fieldId: string;
  oldValue?: unknown;
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
 * A computed cell that exceeded the persisted-value byte cap. Isolated async
 * updates revert the column to `oldValue` and continue the rest of the cascade.
 */
export type ComputedCellLimitRejection = {
  tableId: string;
  recordId: string;
  fieldId: string;
  column: string;
  /** Postgres column type — jsonb columns need re-serialization on revert. */
  columnType: string;
  oldValue: unknown;
  attempted: number;
  max: number;
};

export const formatComputedCellLimitErrorMessage = (attempted: number, max: number): string =>
  `Computed cell value is too large (${attempted} / ${max} bytes). Shorten the source data or change the formula.`;

/**
 * Result of computed update execution with optional change data.
 */
/**
 * Outcome of running dirty propagation under options.maxDirtyRecords.
 * - 'exceeded' (abort mode): propagation stopped, no steps were executed; the
 *   caller must retry with a smaller stage plan.
 * - 'partial' (partial mode): propagation stopped at the budget but the steps
 *   ran against the materialized batch; the caller must continue with the
 *   processed records excluded until propagation completes.
 */
export type ComputedUpdateDirtyBudgetOutcome =
  | { status: 'exceeded'; dirtyRecordsAtAbort: number }
  | {
      status: 'partial';
      propagatedDirtyRecords: number;
      /**
       * Which side of the budget cut this batch short.
       * - 'seeding': bounded whole-table seeding has more source rows to seed;
       *   the seeded slice's propagation completed, so the slice may retire.
       * - 'propagation': the seeded slice's targets are not fully materialized;
       *   sources must NOT retire — the next batch re-seeds the slice and
       *   progresses via target-side exclusions.
       * - 'both': seeding truncated and the slice's propagation also truncated.
       */
      truncated: 'seeding' | 'propagation' | 'both';
      /**
       * How many frontier-queue rows this batch seeded (a stable prefix).
       * Settlement retires exactly this prefix once propagation completed.
       */
      frontierConsumed?: number;
      /**
       * Highest run-ledger seq among the consumed frontier prefix; settlement
       * retires ledger rows up to this seq once propagation completed.
       */
      frontierMaxSeq?: string;
      /**
       * Advanced whole-table seeding cursors (last __id seeded per table).
       * Settlement persists them once the slice's propagation completed.
       */
      seedAllCursors?: Readonly<Record<string, string>>;
      /**
       * Every table this batch seeded in whole-table form (explicit seed-all and
       * the implicit schema-update case alike). Settlement normalizes them into
       * explicit seedAllTableIds on the continuation, so classification never
       * re-derives the implicit case from the (migrated-away) seed fields.
       */
      wholeTableSeedTables?: ReadonlyArray<string>;
    };

export type ComputedUpdateResult = {
  /** Change data by step, used for event generation */
  changesByStep: ReadonlyArray<StepChangeData>;
  /** Present only when a dirty budget cut this run short; absent = complete run. */
  dirtyBudget?: ComputedUpdateDirtyBudgetOutcome;
  /**
   * Oversized computed cells that were reverted in-place so the rest of the
   * update could commit. Absent unless isolateOversizedComputedCells was set.
   */
  rejectedCells?: ReadonlyArray<ComputedCellLimitRejection>;
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
  /** Present only when maxDirtyRecords stopped propagation early. */
  dirtyBudget?: ComputedUpdateDirtyBudgetOutcome;
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
  rejectedCells?: ReadonlyArray<ComputedCellLimitRejection>;
}

/**
 * Result from executePreparedSteps including optional change data.
 */
export type ExecutePreparedStepsResult = {
  traceInfos: ReadonlyArray<StepTraceInfo>;
  changesByStep: ReadonlyArray<StepChangeData>;
  rejectedCells?: ReadonlyArray<ComputedCellLimitRejection>;
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

const lockUnavailable = (statement: ComputedUpdateLockStatement) =>
  err(
    domainError.infrastructure({
      code: COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE,
      message: `Computed update lock unavailable: ${statement.key}`,
      details: {
        lockKey: statement.key,
        lockScope: statement.scope,
        lockTableId: statement.tableId,
        lockBatchId: statement.batchId,
        lockRecordId: statement.recordId,
        lockShared: statement.shared,
      },
    })
  );

const acquireTableLock = async (
  db: Kysely<DynamicDB>,
  statement: ComputedUpdateLockStatement,
  waitForLocks: boolean
): Promise<Result<ComputedUpdateLockSummary, DomainError> | undefined> => {
  if (waitForLocks) {
    await db.executeQuery(
      statement.shared
        ? buildSharedAdvisoryLockQuery(db, statement.key)
        : buildAdvisoryLockQuery(db, statement.key)
    );
    return undefined;
  }
  const result = await db.executeQuery(
    statement.shared
      ? buildTrySharedAdvisoryLockQuery(db, statement.key)
      : buildTryAdvisoryLockQuery(db, statement.key)
  );
  if (result.rows[0]?.locked !== true) {
    return lockUnavailable(statement);
  }
  return undefined;
};

/**
 * Seed-input eligibility, shared by execute() and prepareDirtyState() so the
 * rules cannot drift: seedAllTableIds is real seed input (a continuation
 * carrying only seed-all tables must not be mistaken for a schema-update
 * "seed everything" run), and the stage ledger's frontier queue counts too —
 * probed only when everything else is empty.
 */
const resolveSeedInputEligibility = async (
  db: Kysely<DynamicDB>,
  plan: ComputedUpdatePlan,
  ledgerScopeId: string | undefined
): Promise<
  Result<{ noSeedInput: boolean; shouldSeedAllForSchemaUpdate: boolean }, DomainError>
> => {
  const noExplicitSeedInput =
    plan.seedRecordIds.length === 0 &&
    plan.extraSeedRecords.length === 0 &&
    (plan.seedAllTableIds ?? []).length === 0;
  let ledgerFrontierPresent = false;
  if (
    (plan.steps.length > 0 || plan.edges.length > 0) &&
    noExplicitSeedInput &&
    ledgerScopeId !== undefined
  ) {
    const hasFrontier = await stageLedgerHasFrontier(db, ledgerScopeId);
    if (hasFrontier.isErr()) return err(hasFrontier.error);
    ledgerFrontierPresent = hasFrontier.value;
  }
  const noSeedInput = noExplicitSeedInput && !ledgerFrontierPresent;
  return ok({
    noSeedInput,
    shouldSeedAllForSchemaUpdate: noSeedInput && plan.changeType === 'update',
  });
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
    private readonly typeValidationStrategy: IPgTypeValidationStrategy,
    @inject(v2CoreTokens.tableDataSafetyLimitComposer)
    private readonly tableDataSafetyLimitComposer: TableDataSafetyLimitComposer = new TableDataSafetyLimitComposer()
  ) {}

  private async executeComputedQuery(
    db: Kysely<DynamicDB>,
    compiled: CompiledQuery,
    context: {
      source: string;
      tableId: string;
      tableName: string;
      fieldIds: ReadonlyArray<string>;
      stepLevel: number;
    }
  ) {
    try {
      return await db.executeQuery(compiled);
    } catch (error) {
      throw new PostgresSqlExecutionError(error, compiled, context);
    }
  }

  async execute(
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    run?: ComputedUpdateRunContext,
    options?: {
      collectChanges?: boolean;
      /** Track selected source tables and invalidate evidence for excluded tables. */
      valueFrontier?: { tableIds: ReadonlyArray<string> };
      lockWait?: boolean;
      maxDirtyRecords?: number;
      dirtyBudgetMode?: 'abort' | 'partial';
      /**
       * Scope id (the continuation chain's root task id) of the staged
       * execution's durable stage ledger. When set, the frontier queue seeds
       * from — and processed targets anti-join against —
       * computed_update_stage_ledger instead of plan-carried record arrays.
       */
      ledgerScopeId?: string;
      /**
       * When true (async worker only), oversized non-link computed cells are
       * reverted to their previous value so the rest of the cascade can commit.
       * Synchronous user-facing updates keep the default fail-and-rollback.
       */
      isolateOversizedComputedCells?: boolean;
    }
  ): Promise<Result<ComputedUpdateResult, DomainError>> {
    const executeDb = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
    if (options?.ledgerScopeId && options.valueFrontier !== undefined) {
      // A partial batch can become untracked after a budget/config change.
      // Invalidate old table coverage before processing even overlapping rows.
      await clearChangeFrontier(executeDb, options.ledgerScopeId, options.valueFrontier.tableIds);
    }
    if (plan.steps.length === 0 && plan.edges.length === 0) {
      return ok({ changesByStep: [] });
    }
    // Backfill joins on computed expressions (e.g. the to_jsonb-wrapped field
    // comparisons of conditional lookups) have no column statistics, so the
    // planner's inflated row estimates routinely push the statement cost past
    // jit_optimize_above_cost and pay a one-off LLVM compile of ~400ms per
    // backfill. These are one-shot dynamic statements — JIT never amortizes.
    if (getPostgresTransaction(context)) {
      await executeDb.executeQuery(sql.raw('SET LOCAL jit = off').compile(executeDb));
    }
    const eligibility = await resolveSeedInputEligibility(executeDb, plan, options?.ledgerScopeId);
    if (eligibility.isErr()) return err(eligibility.error);
    if (eligibility.value.noSeedInput && !eligibility.value.shouldSeedAllForSchemaUpdate) {
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
      ledgerScopeId: options?.ledgerScopeId,
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
          const prepared = yield* await this.prepareDirtyState(effectivePlan, context, {
            maxDirtyRecords: options?.maxDirtyRecords,
            dirtyBudgetMode: options?.dirtyBudgetMode,
            ledgerScopeId: options?.ledgerScopeId,
          });
          const dirtyBudget = prepared.propagationStats.dirtyBudget;
          if (dirtyBudget?.status === 'exceeded') {
            mainSpan?.setAttribute('computed.dirtyBudgetOutcome', 'exceeded');
            runLogger.warn('computed:run:dirty_budget_exceeded', {
              maxDirtyRecords: options?.maxDirtyRecords,
              dirtyRecordsAtAbort: dirtyBudget.dirtyRecordsAtAbort,
              stepCount: effectivePlan.steps.length,
              edgeCount: effectivePlan.edges.length,
            });
            return ok({ changesByStep: [], dirtyBudget });
          }
          if (dirtyBudget?.status === 'partial') {
            mainSpan?.setAttribute('computed.dirtyBudgetOutcome', 'partial');
            runLogger.info('computed:run:dirty_budget_partial', {
              maxDirtyRecords: options?.maxDirtyRecords,
              propagatedDirtyRecords: dirtyBudget.propagatedDirtyRecords,
              stepCount: effectivePlan.steps.length,
            });
          }
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
            collectChanges,
            {
              wait: options?.lockWait,
              logContext: toRunLogContext(resolvedRun),
            },
            options?.isolateOversizedComputedCells ?? false
          );
          if (
            collectChanges &&
            options?.ledgerScopeId &&
            options.valueFrontier &&
            options.valueFrontier.tableIds.length > 0
          ) {
            await recordStageValueChanges(
              prepared.db,
              options.ledgerScopeId,
              effectivePlan,
              prepared.tableById,
              stepsResult.changesByStep,
              stepsResult.rejectedCells,
              options.valueFrontier.tableIds
            );
          }
          mainSpan?.setAttribute('computed.executedStepCount', stepsResult.traceInfos.length);

          const completedSteps = resolvedRun.completedStepsBefore + stepsResult.traceInfos.length;
          runLogger.info('computed:run:done', {
            completedSteps,
            pendingSteps: Math.max(resolvedRun.totalSteps - completedSteps, 0),
            durationMs: Date.now() - runStartTime,
          });

          return ok({
            changesByStep: stepsResult.changesByStep,
            ...(dirtyBudget ? { dirtyBudget } : {}),
            ...(stepsResult.rejectedCells?.length
              ? { rejectedCells: stepsResult.rejectedCells }
              : {}),
          });
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
    const writeTableIds = [...new Set(plan.steps.map((step) => step.tableId.toString()))];
    const lockPlan = buildComputedUpdateLockPlan(plan, this.lockConfig, {
      writeTableIds: writeTableIds.length > 0 ? writeTableIds : undefined,
    });
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
        // Table locks (shared covering or exclusive fallback) first, in tableId
        // order, then exclusive record/batch keys. Mixing shared and exclusive
        // in one unnest would take the covering key exclusively and serialize
        // unrelated small updates; taking records before a later table also
        // inverts lock order across multi-table plans.
        const tableStatements = lockPlan.statements
          .filter((statement) => statement.scope === 'table')
          .sort(
            (left, right) =>
              left.tableId.localeCompare(right.tableId) || left.key.localeCompare(right.key)
          );
        const exclusiveKeys = lockPlan.statements
          .filter((statement) => statement.scope !== 'table')
          .map((statement) => statement.key)
          .sort((left, right) => left.localeCompare(right));

        for (const statement of tableStatements) {
          const unavailable = await acquireTableLock(db, statement, waitForLocks);
          if (unavailable) return unavailable;
        }
        if (exclusiveKeys.length > 0) {
          if (waitForLocks) {
            await db.executeQuery(buildAdvisoryLockBatchQuery(db, exclusiveKeys));
          } else {
            const result = await db.executeQuery(buildTryAdvisoryLockBatchQuery(db, exclusiveKeys));
            const lockedByKey = new Map(result.rows.map((row) => [row.key, row.locked]));
            const failed = lockPlan.statements.find(
              (statement) => statement.scope !== 'table' && lockedByKey.get(statement.key) !== true
            );
            if (failed) {
              return lockUnavailable(failed);
            }
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
   * Lock every dirty target record (or batch/table fallback) before writeback.
   *
   * Seed-only locks do not serialize tasks that write the same cascade targets from
   * different seed tables. Holding target locks for the write transaction forces
   * overlapping hybrid workers to requeue (wait=false) or wait (wait=true) instead of
   * overwriting each other's computed columns with stale values.
   */
  async acquireDirtyTargetLocks(
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    prepared: PreparedDirtyState,
    options?: ComputedUpdateLockOptions
  ): Promise<Result<ComputedUpdateLockSummary, DomainError>> {
    if (prepared.totalDirtyRecords === 0 || prepared.dirtyStats.length === 0) {
      return ok({
        mode: 'none',
        totalLocks: 0,
        recordLocks: 0,
        batchLocks: 0,
        tableLocks: 0,
        tableLockTableIds: [],
        seedRecordCount: 0,
        batchShardCount: this.lockConfig.batchShardCount,
      });
    }

    const groupsResult = await this.collectDirtyRecordGroupsForLocks(prepared.db);
    if (groupsResult.isErr()) return err(groupsResult.error);
    const dirtyGroups = groupsResult.value;
    if (dirtyGroups.length === 0) {
      return ok({
        mode: 'none',
        totalLocks: 0,
        recordLocks: 0,
        batchLocks: 0,
        tableLocks: 0,
        tableLockTableIds: [],
        seedRecordCount: 0,
        batchShardCount: this.lockConfig.batchShardCount,
      });
    }

    const lockPlan: ComputedUpdatePlan = {
      ...plan,
      // Dirty groups are the write targets; reuse the seed lock planner without
      // re-locking the original seed list (those are acquired separately).
      seedRecordIds: [],
      extraSeedRecords: dirtyGroups,
    };

    const result = await this.acquireLocks(lockPlan, context, {
      wait: options?.wait,
      logContext: {
        ...options?.logContext,
        lockScope: 'dirty_targets',
        dirtyTableCount: dirtyGroups.length,
        dirtyRecordCount: dirtyGroups.reduce((sum, group) => sum + group.recordIds.length, 0),
      },
    });

    return result;
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
    context: IExecutionContext,
    options?: {
      maxDirtyRecords?: number;
      dirtyBudgetMode?: 'abort' | 'partial';
      /** @see execute — durable stage ledger scope for staged executions. */
      ledgerScopeId?: string;
    }
  ): Promise<Result<PreparedDirtyState, DomainError>> {
    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
    const eligibilityResult = await resolveSeedInputEligibility(db, plan, options?.ledgerScopeId);
    if (eligibilityResult.isErr()) return err(eligibilityResult.error);
    const { noSeedInput, shouldSeedAllForSchemaUpdate } = eligibilityResult.value;
    if (
      (plan.steps.length === 0 && plan.edges.length === 0) ||
      (noSeedInput && !shouldSeedAllForSchemaUpdate)
    ) {
      return ok({
        db,
        tableById: new Map(),
        dirtyStats: [],
        totalDirtyRecords: 0,
        propagationStats: emptyDirtyPropagationStats(),
      });
    }

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

        // Targets already computed by earlier partial batches of this run stage
        // live in the run-scoped ledger (kind 'excluded') and are anti-joined
        // directly by budgeted seeding/propagation, so every batch's LIMIT slots
        // go only to genuinely-new rows — no per-batch copy into the transaction.
        const exclusionScopeId = options?.ledgerScopeId;

        const maxDirtyRecords =
          options?.maxDirtyRecords !== undefined && options.maxDirtyRecords > 0
            ? Math.trunc(options.maxDirtyRecords)
            : undefined;
        const partialMode = maxDirtyRecords !== undefined && options?.dirtyBudgetMode === 'partial';
        // Seeding and propagation share one budget pool: seeding may take at most
        // half so propagation always keeps at least one slot, keeping the
        // per-transaction ceiling at explicit seeds + stageMaxDirtyRecords total.
        const partialSeedingBudget =
          partialMode && maxDirtyRecords !== undefined
            ? Math.max(1, Math.floor(maxDirtyRecords / 2))
            : undefined;
        let seedingConsumed = 0;
        let frontierConsumed = 0;
        let frontierMaxSeq: string | undefined;
        const advancedSeedAllCursors: Record<string, string> = {};
        const wholeTableSeededTables = new Set<string>();
        let seedAllBudgetOutcome: DirtyPropagationStats['dirtyBudget'];

        // Seed dirty records - wrap with span. Full-table seeding (explicit seed-all
        // tables and schema-update runs alike) is budget-bounded: at most `limit`
        // rows materialize per table, and truncation surfaces as a budget outcome
        // instead of flooding the transaction.
        yield* await runWithSpan(
          'teable.ComputedFieldUpdater.seedDirtyRecords',
          async () => {
            const seedWholeTable = async (table: Table): Promise<Result<void, DomainError>> => {
              const tableKey = table.id().toString();
              wholeTableSeededTables.add(tableKey);
              const cursor = plan.seedAllCursors?.[tableKey];
              if (maxDirtyRecords === undefined) {
                if (cursor === undefined) {
                  return seedAllDirtyRecordsForTable(db, table);
                }
                // Cursored plan executed without a budget: seed the remainder only.
                const remainderResult = await seedAllDirtyRecordsForTableBounded(
                  db,
                  table,
                  Number.MAX_SAFE_INTEGER,
                  exclusionScopeId,
                  cursor
                );
                return remainderResult.isErr() ? err(remainderResult.error) : ok(undefined);
              }

              const seedingBudget = partialSeedingBudget ?? maxDirtyRecords;
              const remaining = seedingBudget - seedingConsumed;
              if (remaining <= 0) {
                seedAllBudgetOutcome = partialMode
                  ? {
                      status: 'partial',
                      propagatedDirtyRecords: seedingConsumed,
                      truncated: 'seeding',
                    }
                  : { status: 'exceeded', dirtyRecordsAtAbort: seedingConsumed };
                return ok(undefined);
              }
              const limit = partialMode ? remaining : remaining + 1;
              const seededResult = await seedAllDirtyRecordsForTableBounded(
                db,
                table,
                limit,
                exclusionScopeId,
                cursor
              );
              if (seededResult.isErr()) return err(seededResult.error);
              seedingConsumed += seededResult.value.count;
              if (seededResult.value.lastRecordId !== undefined) {
                advancedSeedAllCursors[tableKey] = seededResult.value.lastRecordId;
              }
              if (seededResult.value.count >= limit) {
                seedAllBudgetOutcome = partialMode
                  ? {
                      status: 'partial',
                      propagatedDirtyRecords: seedingConsumed,
                      truncated: 'seeding',
                    }
                  : { status: 'exceeded', dirtyRecordsAtAbort: seedingConsumed };
              }
              return ok(undefined);
            };

            if (noSeedInput && shouldSeedAllForSchemaUpdate) {
              const seedTable = tableById.get(plan.seedTableId.toString());
              if (!seedTable) {
                return ok(undefined);
              }
              // Fall through: self-referential schema-update continuations carry a
              // frontier that must still seed, or its unfinished propagation is lost.
              const wholeTableResult = await seedWholeTable(seedTable);
              if (wholeTableResult.isErr()) return wholeTableResult;
            }

            for (const tableId of plan.seedAllTableIds ?? []) {
              const table = tableById.get(tableId.toString());
              if (!table) {
                continue;
              }
              const result = await seedWholeTable(table);
              if (result.isErr()) return result;
              if (seedAllBudgetOutcome?.status === 'exceeded') break;
            }

            // Seed individual records for remaining tables. In abort mode they
            // count against the budget BEFORE materializing: a seed set that
            // cannot fit reports exceeded immediately (zero extra rows), the
            // caller shrinks to the floor, and floor entry migrates the seeds
            // into the frontier queue — so every budgeted transaction
            // materializes at most stageMaxDirtyRecords dirty rows (+1 abort
            // probe sentinel), regardless of the seed set's size.
            const explicitSeedCount =
              plan.seedRecordIds.length +
              plan.extraSeedRecords.reduce((sum, group) => sum + group.recordIds.length, 0);
            if (
              !partialMode &&
              maxDirtyRecords !== undefined &&
              !seedAllBudgetOutcome &&
              seedingConsumed + explicitSeedCount > maxDirtyRecords
            ) {
              seedAllBudgetOutcome = {
                status: 'exceeded',
                dirtyRecordsAtAbort: seedingConsumed + explicitSeedCount,
              };
            }
            if (seedAllBudgetOutcome?.status !== 'exceeded') {
              if (plan.seedRecordIds.length > 0) {
                const seedResult = await seedDirtyRecords(db, plan.seedTableId, plan.seedRecordIds);
                if (seedResult.isErr()) return seedResult;
              }
              // INSERT owns only the new rows. Extra seeds are typically the
              // linked foreign record; seeding them expands lookup edges onto
              // every pre-existing sibling host and then contends with the
              // in-flight foreign cascade (first-name-only create-order).
              const seedInsertOnly =
                plan.changeType === 'insert' && (plan.seedAllTableIds?.length ?? 0) === 0;
              if (!seedInsertOnly) {
                const extraResult = await seedExtraDirtyRecords(db, plan.extraSeedRecords);
                if (extraResult.isErr()) return extraResult;
              }
            }
            // Frontier queue: sources for the next self-referential generations,
            // stored seq-ordered in the run ledger. Only a budget-bounded HEAD
            // seeds per batch (sharing the seeding pool with whole-table slices)
            // so a wide generation cannot flood the transaction; the rest of the
            // queue waits for later batches. The consumed head (count + max seq)
            // is reported so settlement can retire exactly the sources whose
            // propagation completed.
            if (exclusionScopeId !== undefined && seedAllBudgetOutcome?.status !== 'exceeded') {
              const seedingBudget = partialSeedingBudget ?? maxDirtyRecords;
              // The frontier never overdraws the seeding pool: with the pool
              // exhausted the queue simply waits for the next batch (reported as
              // a seeding truncation below), keeping the per-transaction total at
              // exactly maxDirtyRecords — seeding <= floor(budget/2), propagation
              // gets the remainder.
              const frontierLimit =
                seedingBudget === undefined
                  ? undefined
                  : Math.max(0, seedingBudget - seedingConsumed);
              const headResult =
                frontierLimit === 0
                  ? // Pool exhausted: seed nothing, but a non-empty queue must
                    // still surface as a remainder (else the stage would complete
                    // and drop it).
                    (await stageLedgerHasFrontier(db, exclusionScopeId)).map((hasQueue) => ({
                      consumed: 0,
                      maxSeq: null,
                      remainder: hasQueue,
                    }))
                  : await seedStageLedgerFrontierHead(db, exclusionScopeId, frontierLimit);
              if (headResult.isErr()) return err(headResult.error);
              frontierConsumed = headResult.value.consumed;
              frontierMaxSeq = headResult.value.maxSeq ?? undefined;
              seedingConsumed += frontierConsumed;
              // An unseeded queue remainder is a seeding truncation: without the
              // partial outcome the stage would complete and drop the queue,
              // losing the remaining sources' propagation entirely.
              if (partialMode && headResult.value.remainder && !seedAllBudgetOutcome) {
                seedAllBudgetOutcome = {
                  status: 'partial',
                  propagatedDirtyRecords: seedingConsumed,
                  truncated: 'seeding',
                };
              }
            }
            return ok(undefined);
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

        // Propagate dirty records - wrap with span so propagateEdge spans are children.
        // Abort mode stops before propagation once seeding exceeded the budget.
        // Partial mode ALWAYS propagates the seeded batch — skipping propagation
        // after truncated seeding would produce zero targets, zero exclusions, and
        // an identical continuation (an infinite loop). Seeding (whole-table slices
        // + frontier prefix) and propagation share one maxDirtyRecords pool, so the
        // per-transaction ceiling is that pool plus the upstream-bounded explicit
        // seeds.
        const propagationStats = (yield* await runWithSpan(
          'teable.ComputedFieldUpdater.propagateDirtyRecords',
          async () => {
            if (seedAllBudgetOutcome && !partialMode) {
              return ok({
                ...emptyDirtyPropagationStats(),
                dirtyBudget: seedAllBudgetOutcome,
              });
            }
            const propagateResult = await propagateDirtyRecords(
              db,
              plan.edges,
              tableById,
              context,
              {
                maxDirtyRecords:
                  partialMode && maxDirtyRecords !== undefined
                    ? Math.max(1, maxDirtyRecords - seedingConsumed)
                    : options?.maxDirtyRecords,
                dirtyBudgetMode: options?.dirtyBudgetMode,
                exclusionScopeId,
              }
            );
            if (propagateResult.isErr() || !seedAllBudgetOutcome) return propagateResult;

            const stats = propagateResult.value;
            const propagationOutcome = stats.dirtyBudget;
            const propagationTruncated =
              propagationOutcome?.status === 'partial' &&
              (propagationOutcome.truncated === 'propagation' ||
                propagationOutcome.truncated === 'both');
            return ok({
              ...stats,
              dirtyBudget: {
                status: 'partial' as const,
                propagatedDirtyRecords:
                  seedingConsumed +
                  (propagationOutcome?.status === 'partial'
                    ? propagationOutcome.propagatedDirtyRecords
                    : 0),
                truncated: propagationTruncated ? ('both' as const) : ('seeding' as const),
              },
            });
          },
          { 'propagate.edgeCount': plan.edges.length }
        )) as DirtyPropagationStats;

        // Attach the consumed frontier prefix to partial outcomes so settlement
        // can retire exactly the sources whose propagation completed.
        if (propagationStats.dirtyBudget?.status === 'partial') {
          propagationStats.dirtyBudget = {
            ...propagationStats.dirtyBudget,
            ...(frontierConsumed > 0 ? { frontierConsumed, frontierMaxSeq } : {}),
            ...(Object.keys(advancedSeedAllCursors).length > 0
              ? { seedAllCursors: { ...plan.seedAllCursors, ...advancedSeedAllCursors } }
              : {}),
            ...(wholeTableSeededTables.size > 0
              ? { wholeTableSeedTables: [...wholeTableSeededTables] }
              : {}),
          };
        }

        if (
          plan.changeType === 'insert' &&
          (plan.seedAllTableIds?.length ?? 0) === 0 &&
          plan.seedRecordIds.length > 0 &&
          !hasSameTableCrossRecordEdge(plan)
        ) {
          yield* await runWithSpan('teable.ComputedFieldUpdater.pruneInsertSeedSiblings', () =>
            pruneInsertSeedTableDirtySiblings(db, plan.seedTableId, plan.seedRecordIds)
          );
        }

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
    collectChanges: boolean = false,
    lockOptions?: ComputedUpdateLockOptions,
    isolateOversizedComputedCells: boolean = false
  ): Promise<Result<ExecutePreparedStepsResult, DomainError>> {
    if (steps.length === 0) return ok({ traceInfos: [], changesByStep: [] });

    // Serialize concurrent hybrid/async writers that touch the same target rows.
    // Seed locks alone are insufficient: User-seed and Order-seed tasks can hold
    // different seed locks while both writing Order computed columns.
    const dirtyLockResult = await this.acquireDirtyTargetLocks(plan, context, prepared, {
      wait: lockOptions?.wait,
      logContext: lockOptions?.logContext,
    });
    if (dirtyLockResult.isErr()) return err(dirtyLockResult.error);

    const updateBuilder = new UpdateFromSelectBuilder(prepared.db);
    const stepTraces: StepTraceInfo[] = [];
    const changesByStep: StepChangeData[] = [];
    const rejectedCells: ComputedCellLimitRejection[] = [];
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
    // Counts affect chunk selection, so read each table on first use rather than
    // trusting a PreparedDirtyState that may have been used by an earlier call.
    // Ordinary steps only update stored cells; rejected-cell restoration below
    // is the only step path that can add dirty rows. Never share this cache
    // across prepared executions or transactions.
    const dirtyCounts = new Map<string, number>();

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
            collectChanges,
            isolateOversizedComputedCells,
            dirtyCounts.get(step.tableId.toString())
          );

          if (stepResult.isErr()) {
            levelSpan?.recordError(stepResult.error.message);
            levelSpan?.end();
            return err(stepResult.error);
          }

          if (stepResult.value.rejectedCells?.length) {
            dirtyCounts.delete(step.tableId.toString());
          } else {
            dirtyCounts.set(step.tableId.toString(), stepResult.value.traceInfo.dirtyRecordCount);
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
        if (result.rejectedCells?.length) {
          rejectedCells.push(...result.rejectedCells);
        }
      }
    }
    return ok({
      traceInfos: stepTraces,
      changesByStep,
      ...(rejectedCells.length > 0 ? { rejectedCells } : {}),
    });
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
    collectChanges: boolean = false,
    isolateOversizedComputedCells: boolean = false,
    knownDirtyCount?: number
  ): Promise<Result<StepExecutionResult, DomainError>> {
    const table = tableById.get(step.tableId.toString());
    if (!table) {
      // Trashed or permanently deleted tables are omitted from loadTables.
      // Skip the step so the rest of a persisted plan can still run.
      return ok({
        traceInfo: {
          tableId: step.tableId.toString(),
          tableName: step.tableId.toString(),
          level: step.level,
          fieldIds: [],
          fieldNames: [],
          sql: '',
          parameterCount: 0,
          dirtyRecordCount: 0,
        },
        recordChanges: [],
      });
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
    const dirtyCount = knownDirtyCount ?? (await this.getDirtyCountForTable(db, step.tableId));

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

          let queryPlans: ComputedUpdateQueryPlan[] | undefined;
          const shouldChunkFields =
            collectChanges && !collapsedBatch && fieldIds.length > COMPUTED_UPDATE_FIELD_CHUNK_SIZE;

          const formulaOnlyFieldLevelsResult = ((): Result<SameTableFieldLevel[], DomainError> => {
            if (fieldIds.length === 0) return ok([]);

            if (collapsedBatch && !collapsedBatch.tableId.equals(step.tableId)) {
              return err(domainError.validation({ message: 'Collapsed batch table mismatch' }));
            }

            const allowedFieldIds = new Set(fieldIds.map((id) => id.toString()));
            const sourceSteps = collapsedBatch
              ? [...collapsedBatch.steps].sort((a, b) => a.level - b.level)
              : [step];
            const fieldLevels: SameTableFieldLevel[] = [];

            for (const sourceStep of sourceSteps) {
              const levelFieldIds: FieldId[] = [];
              for (const fieldId of sourceStep.fieldIds) {
                if (!allowedFieldIds.has(fieldId.toString())) continue;
                const fieldResult = table.getField((f) => f.id().equals(fieldId));
                // Deleted between planning and execution — nothing to compute.
                if (fieldResult.isErr()) continue;
                if (!fieldResult.value.type().equals(FieldType.formula())) {
                  return ok([]);
                }
                levelFieldIds.push(fieldId);
              }
              if (levelFieldIds.length > 0) {
                fieldLevels.push({ level: sourceStep.level, fieldIds: levelFieldIds });
              }
            }

            return ok(fieldLevels);
          })();
          if (formulaOnlyFieldLevelsResult.isErr()) return err(formulaOnlyFieldLevelsResult.error);

          // Formula-only same-table steps use a CTE chain so formula dependencies are computed
          // once and later formulas read CTE columns instead of recursively inlining expressions.
          if (formulaOnlyFieldLevelsResult.value.length > 0 && !shouldChunkFields) {
            const batchBuilder = new SameTableBatchQueryBuilder(db, this.typeValidationStrategy);
            const chunkedRecordIds = this.hasJsonBackedFormulaTarget(
              table,
              formulaOnlyFieldLevelsResult.value
            )
              ? await this.getDirtyRecordIdChunks(
                  db,
                  step.tableId,
                  JSON_SAME_TABLE_BATCH_CHUNK_SIZE,
                  true
                )
              : dirtyCount > SAME_TABLE_BATCH_CHUNK_TRIGGER
                ? await this.getDirtyRecordIdChunks(db, step.tableId)
                : [];
            const effectiveChunks = chunkedRecordIds.length > 0 ? chunkedRecordIds : [undefined];

            stepSpan?.setAttribute('step.sameTableChunkCount', effectiveChunks.length);
            stepSpan?.setAttribute('step.sameTableChunked', effectiveChunks.length > 1);

            const batchQueryPlans: ComputedUpdateQueryPlan[] = [];
            for (const recordIds of effectiveChunks) {
              const batchResult = yield* batchBuilder.build({
                table,
                fieldLevels: formulaOnlyFieldLevelsResult.value,
                ...(recordIds ? { recordIds } : {}),
                dirtyFilter: {
                  tableId: step.tableId.toString(),
                  dirtyTableName: DIRTY_TABLE,
                  tableIdColumn: DIRTY_TABLE_ID_COL,
                  recordIdColumn: DIRTY_RECORD_ID_COL,
                },
              });
              batchQueryPlans.push({ selectQuery: batchResult.selectQuery, fieldIds });
            }
            queryPlans = batchQueryPlans;
          }

          const fieldChunks = shouldChunkFields
            ? chunkArray(fieldIds, COMPUTED_UPDATE_FIELD_CHUNK_SIZE)
            : [fieldIds];

          stepSpan?.setAttribute('step.fieldChunkCount', fieldChunks.length);
          stepSpan?.setAttribute('step.fieldChunked', shouldChunkFields ? 1 : 0);

          if (!queryPlans) {
            const canProbeDistinctHostKeyAggregation =
              dirtyCount > SAME_TABLE_BATCH_CHUNK_TRIGGER &&
              dirtyCount <= DISTINCT_HOST_KEY_UNCHUNK_MAX_DIRTY_RECORDS &&
              fieldIds.every((fieldId) => {
                const fieldResult = table.getField((field) => field.id().equals(fieldId));
                return (
                  fieldResult.isOk() &&
                  (fieldResult.value.type().equals(FieldType.conditionalLookup()) ||
                    fieldResult.value.type().equals(FieldType.conditionalRollup()))
                );
              });

            if (canProbeDistinctHostKeyAggregation) {
              const unchunkedPlans: ComputedUpdateQueryPlan[] = [];
              const hostKeyColumns = new Set<string>();
              let canExecuteUnchunked = true;

              for (const fieldChunk of fieldChunks) {
                const builder = new ComputedTableRecordQueryBuilder(db, {
                  typeValidationStrategy: this.typeValidationStrategy,
                  forceLookupArrayOutput: true,
                })
                  .from(table)
                  .select(fieldChunk)
                  .withDirtyFilter({
                    tableId: step.tableId.toString(),
                    dirtyTableName: DIRTY_TABLE,
                  });
                yield* await builder.prepare({
                  context,
                  tableRepository: this.tableRepository,
                });
                const selectQuery = yield* builder.build();
                this.warnDanglingFieldReferences(builder, {
                  tableId: step.tableId.toString(),
                  stepLevel: step.level,
                });
                canExecuteUnchunked = canExecuteUnchunked && builder.canExecuteUnchunkedDirtySet();
                for (const column of builder.unchunkedHostKeyColumns()) {
                  hostKeyColumns.add(column);
                }
                unchunkedPlans.push({ selectQuery, fieldIds: fieldChunk });
              }

              if (canExecuteUnchunked) {
                canExecuteUnchunked = yield* await this.hasBoundedDistinctHostKeys(
                  db,
                  tableName,
                  step.tableId.toString(),
                  [...hostKeyColumns]
                );
              }

              if (canExecuteUnchunked) {
                queryPlans = unchunkedPlans;
              }
            }

            // Lateral/lookup/mixed steps previously ran one UPDATE over the entire dirty set.
            // Mirror the formula CTE path: when dirty fan-out is large, slice record ids so
            // each statement stays under statement_timeout without changing lock/TX scope.
            const chunkedRecordIds = queryPlans
              ? []
              : dirtyCount > SAME_TABLE_BATCH_CHUNK_TRIGGER
                ? await this.getDirtyRecordIdChunks(db, step.tableId)
                : [];
            const recordIdChunks: ReadonlyArray<ReadonlyArray<string> | undefined> = queryPlans
              ? [undefined]
              : chunkedRecordIds.length > 1
                ? chunkedRecordIds
                : [undefined];

            stepSpan?.setAttribute('step.lateralChunkCount', recordIdChunks.length);
            stepSpan?.setAttribute('step.lateralChunked', recordIdChunks.length > 1 ? 1 : 0);
            stepSpan?.setAttribute('step.distinctHostKeyUnchunked', queryPlans ? 1 : 0);

            if (!queryPlans) {
              queryPlans = [];
              for (const recordIds of recordIdChunks) {
                for (const fieldChunk of fieldChunks) {
                  const builder = new ComputedTableRecordQueryBuilder(db, {
                    typeValidationStrategy: this.typeValidationStrategy,
                    forceLookupArrayOutput: true,
                  })
                    .from(table)
                    .select(fieldChunk)
                    .withDirtyFilter({
                      tableId: step.tableId.toString(),
                      dirtyTableName: DIRTY_TABLE,
                      ...(recordIds ? { recordIds } : {}),
                    });
                  yield* await builder.prepare({
                    context,
                    tableRepository: this.tableRepository,
                  });
                  const selectQuery = yield* builder.build();
                  this.warnDanglingFieldReferences(builder, {
                    tableId: step.tableId.toString(),
                    stepLevel: step.level,
                  });
                  queryPlans.push({ selectQuery, fieldIds: fieldChunk });
                }
              }
            }
          }

          const recordChanges: RecordChangeData[] = [];
          const executedSqls: Array<{ sql: string; parameterCount: number }> = [];
          const rejectedCells: ComputedCellLimitRejection[] = [];

          if (collectChanges) {
            const mergedRecordChanges = new Map<string, RecordChangeData>();

            for (let i = 0; i < queryPlans.length; i++) {
              const { selectQuery, fieldIds: chunkFieldIds } = queryPlans[i];
              const compiledResult = yield* updateBuilder.buildWithReturning({
                table,
                fieldIds: chunkFieldIds,
                selectQuery,
                incrementVersion: !shouldChunkFields,
              });
              executedSqls.push({
                sql: compiledResult.compiled.sql,
                parameterCount: compiledResult.compiled.parameters.length,
              });

              const chunkSuffix =
                queryPlans.length > 1 ? `:chunk=${i + 1}/${queryPlans.length}` : '';
              const sqlLogContext = run
                ? {
                    ...toRunLogContext(run),
                    parameterCount: compiledResult.compiled.parameters.length,
                  }
                : { parameterCount: compiledResult.compiled.parameters.length };
              this.logger.debug(
                `computed:update:table=${tableName}:level=${step.level}${chunkSuffix}:sql:\n${compiledResult.compiled.sql}`,
                sqlLogContext
              );

              const result = await this.executeComputedQuery(db, compiledResult.compiled, {
                source: 'computed_update',
                tableId: step.tableId.toString(),
                tableName,
                fieldIds: chunkFieldIds.map((fieldId) => fieldId.toString()),
                stepLevel: step.level,
              });
              const rows = (result.rows ?? []) as UpdatedRecordRow[];

              // Build change data from returned rows
              const chunkRecordChanges: RecordChangeData[] = [];
              for (const row of rows) {
                const changes: FieldChangeData[] = [];
                for (const [column, fieldId] of compiledResult.columnToFieldId) {
                  const oldValueAlias = compiledResult.oldColumnAliases.get(column);
                  changes.push({
                    fieldId,
                    oldValue: oldValueAlias ? row[oldValueAlias] : undefined,
                    newValue: row[column],
                  });
                }
                chunkRecordChanges.push({
                  recordId: row.__id,
                  oldVersion: row.__old_version,
                  changes,
                });
              }
              const safetyResult = await this.ensureComputedChangesWithinLimit(
                context,
                table,
                chunkRecordChanges,
                compiledResult.columnToFieldId,
                isolateOversizedComputedCells
              );
              if (safetyResult.isErr()) return err(safetyResult.error);
              if (safetyResult.value.length > 0) {
                const revertResult = await this.revertOversizedComputedCells(
                  db,
                  tableName,
                  step.tableId.toString(),
                  step.level,
                  safetyResult.value
                );
                if (revertResult.isErr()) return err(revertResult.error);
                stripRejectedFieldChanges(chunkRecordChanges, safetyResult.value);
                rejectedCells.push(...safetyResult.value);
              }
              if (shouldChunkFields) {
                mergeRecordChanges(mergedRecordChanges, chunkRecordChanges);
              } else {
                pushAll(recordChanges, chunkRecordChanges);
              }
            }

            if (shouldChunkFields) {
              pushAll(recordChanges, mergedRecordChanges.values());
              if (recordChanges.length > 0) {
                const changedRecordIds = [...mergedRecordChanges.keys()];
                const versionBump = sql`update ${sql.raw(toQualifiedIdentifierLiteral(tableName))}
                  set "__version" = "__version" + 1
                  where "__id" in (${sql.join(changedRecordIds)})`.compile(db);
                executedSqls.push({
                  sql: versionBump.sql,
                  parameterCount: versionBump.parameters.length,
                });
                await this.executeComputedQuery(db, versionBump, {
                  source: 'computed_version_bump',
                  tableId: step.tableId.toString(),
                  tableName,
                  fieldIds: [],
                  stepLevel: step.level,
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

            return ok({
              traceInfo,
              recordChanges,
              ...(rejectedCells.length > 0 ? { rejectedCells } : {}),
            });
          }

          for (let i = 0; i < queryPlans.length; i++) {
            const { selectQuery, fieldIds: chunkFieldIds } = queryPlans[i];
            const compiled = yield* updateBuilder.build({
              table,
              fieldIds: chunkFieldIds,
              selectQuery,
              // Note: dirtyFilter is applied on the ComputedTableRecordQueryBuilder above
              // This ensures the dirty JOIN is placed BEFORE lateral joins for optimal query planning
            });
            executedSqls.push({
              sql: compiled.sql,
              parameterCount: compiled.parameters.length,
            });

            const chunkSuffix = queryPlans.length > 1 ? `:chunk=${i + 1}/${queryPlans.length}` : '';
            const sqlLogContext = run
              ? { ...toRunLogContext(run), parameterCount: compiled.parameters.length }
              : { parameterCount: compiled.parameters.length };
            this.logger.debug(
              `computed:update:table=${tableName}:level=${step.level}${chunkSuffix}:sql:\n${compiled.sql}`,
              sqlLogContext
            );

            await this.executeComputedQuery(db, compiled, {
              source: 'computed_update',
              tableId: step.tableId.toString(),
              tableName,
              fieldIds: chunkFieldIds.map((fieldId) => fieldId.toString()),
              stepLevel: step.level,
            });
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

  private async ensureComputedChangesWithinLimit(
    context: IExecutionContext,
    table: Table,
    recordChanges: ReadonlyArray<RecordChangeData>,
    columnToFieldId: ReadonlyMap<string, string>,
    isolateOversizedComputedCells: boolean
  ): Promise<Result<ComputedCellLimitRejection[], DomainError>> {
    const configResult = await this.tableDataSafetyLimitComposer.compose(context);
    if (configResult.isErr()) return err(configResult.error);
    const limits = resolveTableDataSafetyLimits(configResult.value);
    const linkFieldIds = new Set(
      table
        .getFields((field) => field.type().equals(FieldType.link()))
        .map((field) => field.id().toString())
    );
    // Only needed when a rejection actually occurs — keep the no-rejection
    // fast path (every clean chunk) allocation-free.
    let fieldIdToColumn: Map<string, string> | undefined;
    const columnTypeByFieldId = new Map<string, string>();
    const rejections: ComputedCellLimitRejection[] = [];

    for (const recordChange of recordChanges) {
      for (const change of recordChange.changes) {
        // Link values are a projection of junction/FK rows rather than an independent user value.
        // Rejecting a large projection leaves that cache stale even though the relation is valid.
        if (linkFieldIds.has(change.fieldId)) continue;

        const bytes = measureJsonBytes(change.newValue);
        if (bytes <= limits.computed.maxComputedCellValueBytes) continue;

        const details = {
          tableId: table.id().toString(),
          recordId: recordChange.recordId,
          fieldId: change.fieldId,
          attempted: bytes,
          max: limits.computed.maxComputedCellValueBytes,
        };
        const oversizedError = () =>
          domainError.validation({
            code: tableDataSafetyLimitErrors.computedCellValueMaxBytes.code,
            message:
              'Table data safety limit exceeded: validation.limit.computed_cell_value_max_bytes',
            details,
            localization: {
              i18nKey: tableDataSafetyLimitErrors.computedCellValueMaxBytes.i18nKey,
              context: { max: limits.computed.maxComputedCellValueBytes },
            },
          });
        if (!isolateOversizedComputedCells) {
          return err(oversizedError());
        }

        fieldIdToColumn ??= new Map(
          [...columnToFieldId.entries()].map(([column, fieldId]) => [fieldId, column])
        );
        const column = fieldIdToColumn.get(change.fieldId);
        if (!column) {
          return err(oversizedError());
        }

        let columnType = columnTypeByFieldId.get(change.fieldId);
        if (columnType === undefined) {
          const fieldResult = table.getField((field) => field.id().toString() === change.fieldId);
          const columnTypeResult = fieldResult.andThen((field) => resolveColumnType(field));
          // Without the column type the revert cannot re-serialize the old
          // value safely — fall back to the fail-closed error.
          if (columnTypeResult.isErr()) {
            return err(oversizedError());
          }
          columnType = String(columnTypeResult.value);
          columnTypeByFieldId.set(change.fieldId, columnType);
        }

        rejections.push({
          ...details,
          column,
          columnType,
          oldValue: change.oldValue,
        });
      }
    }

    return ok(rejections);
  }

  private async revertOversizedComputedCells(
    db: Kysely<DynamicDB>,
    tableName: string,
    tableId: string,
    stepLevel: number,
    rejections: ReadonlyArray<ComputedCellLimitRejection>
  ): Promise<Result<void, DomainError>> {
    const rejectionsByColumn = new Map<string, ComputedCellLimitRejection[]>();
    for (const rejection of rejections) {
      const group = rejectionsByColumn.get(rejection.column);
      if (group) group.push(rejection);
      else rejectionsByColumn.set(rejection.column, [rejection]);
    }

    for (const [column, group] of rejectionsByColumn) {
      const columnType = group[0]!.columnType;
      // Cast is spliced as raw SQL; the type names come from our own column
      // visitor, but keep an allowlist-shaped guard between them and sql.raw.
      if (!/^[a-z][a-z ]*$/.test(columnType)) {
        return err(
          domainError.invariant({
            message: `Cannot revert oversized computed cells: unexpected column type "${columnType}"`,
            details: { tableId, column, columnType },
          })
        );
      }
      const castSuffix = sql.raw(`::${columnType}`);
      for (const chunk of chunkArray(group, 500)) {
        const valueRows = chunk.map(
          (rejection) =>
            // The RETURNING old value was parsed by the pg driver, so jsonb
            // values are live JS arrays/objects/strings here — they must be
            // re-serialized to JSON text before being bound as jsonb input.
            sql`(${rejection.recordId}::text, ${encodeRevertValue(rejection)}${castSuffix})`
        );
        const compiled = sql`update ${sql.raw(toQualifiedIdentifierLiteral(tableName))} as "__t"
          set ${sql.raw(quoteIdentifier(column))} = "__v"."val"
          from (values ${sql.join(valueRows)}) as "__v"("__id", "val")
          where "__t"."__id" = "__v"."__id"`.compile(db);
        await this.executeComputedQuery(db, compiled, {
          source: 'computed_limit_revert',
          tableId,
          tableName,
          fieldIds: [group[0]!.fieldId],
          stepLevel,
        });
      }
      this.logger.warn('computed:update:cell_value_limit_isolated', {
        tableId,
        fieldId: group[0]!.fieldId,
        rejectedCount: group.length,
        maxAttempted: group.reduce((acc, rejection) => Math.max(acc, rejection.attempted), 0),
        max: group[0]!.max,
        sampleRecordIds: group.slice(0, 10).map((rejection) => rejection.recordId),
      });
    }

    // Dependent fields computed in the same collapsed statement read the
    // rejected value in-statement, so their stored values no longer match the
    // reverted column. Re-dirty the affected records; the continuation stage
    // (seeded with the rejected field ids) recomputes those dependents from
    // the reverted stored value.
    const dirtyRows = [...new Set(rejections.map((rejection) => rejection.recordId))].map(
      (recordId) => ({
        [DIRTY_TABLE_ID_COL]: tableId,
        [DIRTY_RECORD_ID_COL]: recordId,
      })
    );
    for (const chunk of chunkArray(dirtyRows, 500)) {
      await db
        .insertInto(DIRTY_TABLE)
        .values([...chunk])
        .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
        .execute();
    }

    return ok(undefined);
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

  private warnDanglingFieldReferences(
    builder: ComputedTableRecordQueryBuilder,
    logContext: Record<string, unknown>
  ): void {
    const dangling = builder.danglingFieldReferences();
    if (dangling.length === 0) return;
    this.logger.warn('computed:update:dangling_field_reference_degraded', {
      ...logContext,
      danglingFieldReferences: dangling,
    });
  }

  private async hasBoundedDistinctHostKeys(
    db: Kysely<DynamicDB>,
    tableName: string,
    tableId: string,
    columns: ReadonlyArray<string>
  ): Promise<Result<boolean, DomainError>> {
    if (columns.length === 0) return ok(false);

    try {
      for (const column of columns) {
        const hostKeyRef = sql.raw(`${quoteIdentifier('h')}.${quoteIdentifier(column)}`);
        const query = sql`
          select count(*)::integer as "count"
          from (
            select distinct ${hostKeyRef} as "__key"
            from ${sql.raw(toQualifiedIdentifierLiteral(tableName))} as "h"
            inner join ${sql.table(DIRTY_TABLE)} as "d"
              on "d".${sql.raw(quoteIdentifier(DIRTY_RECORD_ID_COL))} = "h"."__id"
            where "d".${sql.raw(quoteIdentifier(DIRTY_TABLE_ID_COL))} = ${tableId}
            limit ${DISTINCT_HOST_KEY_UNCHUNK_MAX_KEYS + 1}
          ) as "__keys"
        `.compile(db);
        const result = await db.executeQuery(query);
        const count = Number(
          (result.rows[0] as { count?: number | string } | undefined)?.count ?? 0
        );
        if (count > DISTINCT_HOST_KEY_UNCHUNK_MAX_KEYS) {
          return ok(false);
        }
      }
      return ok(true);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to inspect conditional host-key cardinality: ${describeError(error)}`,
        })
      );
    }
  }

  private hasJsonBackedFormulaTarget(
    table: Table,
    fieldLevels: ReadonlyArray<SameTableFieldLevel>
  ): boolean {
    return fieldLevels.some((level) =>
      level.fieldIds.some((fieldId) => {
        const fieldResult = table.getField((field) => field.id().equals(fieldId));
        if (fieldResult.isErr()) return false;
        return fieldResult.value
          .dbFieldType()
          .map((type) => type.isJson())
          .unwrapOr(false);
      })
    );
  }

  private async getDirtyRecordIdChunks(
    db: Kysely<DynamicDB>,
    tableId: TableId,
    chunkSize = SAME_TABLE_BATCH_CHUNK_SIZE,
    includeSingleton = false
  ): Promise<ReadonlyArray<ReadonlyArray<string>>> {
    const recordIds = await this.getDirtyRecordIdsForTable(db, tableId);
    if (recordIds.length === 0) return [];
    if (!includeSingleton && recordIds.length <= chunkSize) return [recordIds];
    return splitIntoChunks(recordIds, chunkSize);
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

  /**
   * Collect dirty record ids grouped by table for target-lock acquisition.
   */
  private async collectDirtyRecordGroupsForLocks(
    db: Kysely<DynamicDB>
  ): Promise<Result<ComputedSeedGroup[], DomainError>> {
    try {
      const rows = await db
        .selectFrom(DIRTY_TABLE)
        .select([
          sql.ref(DIRTY_TABLE_ID_COL).as('tableId'),
          sql.ref(DIRTY_RECORD_ID_COL).as('recordId'),
        ])
        .execute();

      if (rows.length === 0) return ok([]);

      const groups = new Map<string, { tableId: TableId; recordIds: RecordId[] }>();
      for (const row of rows) {
        const tableIdValue = String(row.tableId);
        const recordIdValue = String(row.recordId);

        const tableIdResult = TableId.create(tableIdValue);
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
          message: `Failed to collect dirty target lock records: ${describeError(error)}`,
        })
      );
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
        for (const tableId of plan.seedAllTableIds ?? []) {
          tableIds.set(tableId.toString(), tableId);
        }

        if (tableIds.size === 0) return ok([]);

        const spec = yield* Table.specs(plan.baseId)
          .withoutBaseId()
          .byIds([...tableIds.values()])
          .build();
        const tables = yield* await this.tableRepository.find(context, spec, {
          state: 'activeWithPending',
        });

        return ok(tables);
      }.bind(this)
    );
  }

  /**
   * Collect dirty record ids per table for chaining to the next stage.
   */
  async collectDirtySeedGroups(
    context: IExecutionContext,
    tableIds: ReadonlyArray<TableId>,
    options?: {
      /**
       * 'auto' (default) switches a table to the seed-all form above seedAllThreshold;
       * 'exact-ids' always returns record ids — required for partial-batch exclusion
       * sets, where a seed-all form would wrongly exclude unprocessed rows.
       */
      representation?: 'auto' | 'exact-ids';
      /** Row count above which 'auto' returns a table as seed-all instead of ids. */
      seedAllThreshold?: number;
    }
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

      const SEED_ALL_THRESHOLD =
        options?.representation === 'exact-ids'
          ? Number.POSITIVE_INFINITY
          : options?.seedAllThreshold ?? DEFAULT_SEED_ALL_THRESHOLD;
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

  /**
   * Push explicit seed groups onto the run ledger's frontier queue head (floor
   * entry seed migration). Must run in the worker's stage transaction BEFORE
   * execute so the batch seeds them as the queue's budget-bounded head.
   */
  async pushStageLedgerFrontierSeeds(
    context: IExecutionContext,
    scopeId: string,
    groups: ReadonlyArray<{ tableId: TableId; recordIds: ReadonlyArray<RecordId> }>
  ): Promise<Result<number, DomainError>> {
    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
    return pushStageLedgerFrontierHead(
      db,
      scopeId,
      groups.map((group) => ({
        tableId: group.tableId.toString(),
        recordIds: group.recordIds.map((recordId) => recordId.toString()),
      }))
    );
  }

  /**
   * Settle a partial batch entirely SQL-side, in the stage transaction, while
   * the batch's dirty temp table is still alive:
   * 1. retire the consumed frontier head when its propagation completed;
   * 2. (self-referential stages) append rows NEW this batch to the queue tail;
   * 3. add the batch's processed step-table rows to the exclusion ledger.
   * Returns per-table processed counts for the continuation's dirty stats.
   */
  async settleStageLedgerPartialBatch(
    context: IExecutionContext,
    params: {
      scopeId: string;
      stepTableIds: ReadonlyArray<TableId>;
      appendFrontier: boolean;
      /** Highest consumed frontier seq; null when propagation truncated (no retire). */
      retireFrontierUpToSeq: string | null;
      /** Ledger lifecycle: 'carry-sources' while deferred edge chunks remain. */
      settlementMode: ComputedStageLedgerSettlementMode;
    }
  ): Promise<
    Result<
      {
        processedByTable: Array<{ tableId: string; recordCount: number }>;
        newFrontierRows: number;
        retiredFrontierRows: number;
      },
      DomainError
    >
  > {
    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
    let retiredFrontierRows = 0;
    if (params.retireFrontierUpToSeq !== null) {
      const retired = await retireStageLedgerFrontierHead(
        db,
        params.scopeId,
        params.retireFrontierUpToSeq,
        { preserveAsConsumed: params.settlementMode === 'carry-sources' }
      );
      if (retired.isErr()) return err(retired.error);
      retiredFrontierRows = retired.value;
    }
    const appended = await appendStageLedgerPartialBatch(
      db,
      params.scopeId,
      params.stepTableIds.map((tableId) => tableId.toString()),
      { appendFrontier: params.appendFrontier }
    );
    if (appended.isErr()) return err(appended.error);
    return ok({
      processedByTable: appended.value.processedByTable,
      newFrontierRows: appended.value.newFrontierRows,
      retiredFrontierRows,
    });
  }

  /**
   * Collect a completed stage's dirty outputs (batch dirty rows ∪ the scope's
   * exclusion ledger) as next-stage seed groups, entirely SQL-side: no union is
   * materialized anywhere, per-table counts pick the representation, and the
   * total exact ids fetched into JS are hard-capped (overflow tables convert to
   * whole-table seeds).
   */
  async collectStageOutputSeedGroups(
    context: IExecutionContext,
    params: {
      scopeId: string;
      tableIds: ReadonlyArray<TableId>;
      seedAllThreshold?: number;
      exactIdsTotalCap: number;
      /** Ledger lifecycle: 'carry-sources' collects preserved consumed sources. */
      settlementMode: ComputedStageLedgerSettlementMode;
      valueFrontierFields?: ReadonlyArray<{ tableId: string; fieldIds: ReadonlyArray<string> }>;
      allowConsumedPruning?: boolean;
    }
  ): Promise<
    Result<
      { groups: ComputedSeedGroup[]; seedAllTableIds: TableId[]; valuePrunedTableIds?: string[] },
      DomainError
    >
  > {
    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
    const collected = await collectStageOutputSeedGroups(
      db,
      params.scopeId,
      [...new Set(params.tableIds.map((tableId) => tableId.toString()))],
      {
        seedAllThreshold: params.seedAllThreshold ?? DEFAULT_SEED_ALL_THRESHOLD,
        exactIdsTotalCap: params.exactIdsTotalCap,
        includeConsumedSources: params.settlementMode === 'carry-sources',
        valueFrontierFields: params.valueFrontierFields,
        allowConsumedPruning: params.allowConsumedPruning,
      }
    );
    if (collected.isErr()) return err(collected.error);
    const tableIdByKey = new Map(params.tableIds.map((tableId) => [tableId.toString(), tableId]));
    const toTableId = (key: string): Result<TableId, DomainError> => {
      const existing = tableIdByKey.get(key);
      return existing ? ok(existing) : TableId.create(key);
    };
    const groups: ComputedSeedGroup[] = [];
    for (const group of collected.value.groups) {
      const tableId = toTableId(group.tableId);
      if (tableId.isErr()) return err(tableId.error);
      const recordIds: RecordId[] = [];
      for (const rawRecordId of group.recordIds) {
        const recordId = RecordId.create(rawRecordId);
        if (recordId.isErr()) return err(recordId.error);
        recordIds.push(recordId.value);
      }
      groups.push({ tableId: tableId.value, recordIds });
    }
    const seedAllTableIds: TableId[] = [];
    for (const key of collected.value.seedAllTableIds) {
      const tableId = toTableId(key);
      if (tableId.isErr()) return err(tableId.error);
      seedAllTableIds.push(tableId.value);
    }
    return ok({
      groups,
      seedAllTableIds,
      ...(collected.value.valuePrunedTableIds?.length
        ? { valuePrunedTableIds: collected.value.valuePrunedTableIds }
        : {}),
    });
  }

  async cleanupValueFrontierOrphans(
    context: IExecutionContext,
    afterScope: string
  ): Promise<Result<{ afterScope: string; deleted: number }, DomainError>> {
    try {
      const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
      return ok(await cleanupChangeFrontierOrphans(db, afterScope));
    } catch (error) {
      return err(
        domainError.infrastructure({ message: `Failed to clean value frontier: ${String(error)}` })
      );
    }
  }

  /** Drop all stage-ledger state (stage completion or chain dead-letter). */
  async clearTaskStageLedger(
    context: IExecutionContext,
    scopeId: string
  ): Promise<Result<number, DomainError>> {
    const db = resolvePostgresDbOrTx(this.db, context) as unknown as Kysely<DynamicDB>;
    return clearStageLedger(db, scopeId);
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
        ${sql.raw(DIRTY_GENERATION_COL)} integer not null default 0,
        primary key (${sql.raw(DIRTY_TABLE_ID_COL)}, ${sql.raw(DIRTY_RECORD_ID_COL)})
      ) on commit drop`.compile(db)
    );
    await db.executeQuery(
      sql`create index tmp_computed_dirty_frontier_idx on ${sql.table(DIRTY_TABLE)} (
        ${sql.raw(DIRTY_GENERATION_COL)},
        ${sql.raw(DIRTY_TABLE_ID_COL)},
        ${sql.raw(DIRTY_RECORD_ID_COL)}
      )`.compile(db)
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
const hasSameTableCrossRecordEdge = (
  plan: Pick<ComputedUpdatePlan, 'seedTableId' | 'edges'>
): boolean => {
  const seedTableId = plan.seedTableId.toString();
  return plan.edges.some(
    (edge) =>
      edge.fromTableId.toString() === seedTableId && edge.toTableId.toString() === seedTableId
  );
};

const pruneInsertSeedTableDirtySiblings = async (
  db: Kysely<DynamicDB>,
  seedTableId: TableId,
  seedRecordIds: ReadonlyArray<{ toString(): string }>
): Promise<Result<void, DomainError>> => {
  if (seedRecordIds.length === 0) return ok(undefined);
  try {
    await db
      .deleteFrom(DIRTY_TABLE)
      .where(DIRTY_TABLE_ID_COL, '=', seedTableId.toString())
      .where(
        DIRTY_RECORD_ID_COL,
        'not in',
        seedRecordIds.map((recordId) => recordId.toString())
      )
      .execute();
    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to prune insert seed-table dirty siblings: ${describeError(error)}`,
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

/**
 * Budget-bounded variant of full-table seeding: materializes at most `limit` rows
 * per statement, skipping rows already dirty (earlier tables / re-seeded exclusions)
 * and, when active, targets processed by earlier partial batches. Returns the
 * candidate count so callers can detect truncation exactly like the propagation
 * inserts do.
 */
const seedAllDirtyRecordsForTableBounded = async (
  db: Kysely<DynamicDB>,
  table: Table,
  limit: number,
  exclusionScopeId: string | undefined,
  cursor?: string
): Promise<Result<{ count: number; lastRecordId?: string }, DomainError>> => {
  const tableNameResult = table.dbTableName().andThen((dbTableName) => dbTableName.value());
  if (tableNameResult.isErr()) return err(tableNameResult.error);

  try {
    let src = db
      .selectFrom(`${tableNameResult.value} as t` as keyof DynamicDB)
      .select([
        sql.lit(table.id().toString()).as(DIRTY_TABLE_ID_COL),
        sql.ref('t.__id').as(DIRTY_RECORD_ID_COL),
        sql.lit(0).as(DIRTY_GENERATION_COL),
      ])
      .where(
        sql<boolean>`not exists (
          select 1 from ${sql.table(DIRTY_TABLE)} as existing_dirty
          where existing_dirty.${sql.raw(DIRTY_TABLE_ID_COL)} = ${sql.lit(table.id().toString())}
            and existing_dirty.${sql.raw(DIRTY_RECORD_ID_COL)} = t.__id
        )`
      );
    if (exclusionScopeId !== undefined) {
      src = src.where(
        sql<boolean>`not exists (
          select 1 from ${sql.table(STAGE_LEDGER_TABLE)} as processed_target
          where processed_target.scope_id = ${exclusionScopeId}
            and processed_target.kind = 'excluded'
            and processed_target.table_id = ${sql.lit(table.id().toString())}
            and processed_target.record_id = t.__id
        )`
      );
    }
    // Cursor resume: a PK-ordered index range scan gives O(1) durable state per
    // table instead of a per-row exclusion ledger, and bounds the scan itself.
    if (cursor !== undefined) {
      src = src.where(sql<boolean>`t.__id > ${sql.lit(cursor)}`);
    }
    src = src.orderBy(sql.ref('t.__id')).limit(limit);

    const columnList = sql.raw(
      `${DIRTY_TABLE_ID_COL}, ${DIRTY_RECORD_ID_COL}, ${DIRTY_GENERATION_COL}`
    );
    const compiled = sql<{ cnt: number; last_id: string | null }>`
      with src as materialized (${src}),
      ins as (
        insert into ${sql.table(DIRTY_TABLE)} (${columnList})
        select ${columnList} from src
        on conflict (${sql.raw(`${DIRTY_TABLE_ID_COL}, ${DIRTY_RECORD_ID_COL}`)}) do nothing
      )
      select count(*)::int as cnt, max(${sql.raw(DIRTY_RECORD_ID_COL)}) as last_id from src
    `.compile(db);

    const result = await db.executeQuery(compiled);
    const row = result.rows[0] as { cnt?: number; last_id?: string | null } | undefined;
    return ok({
      count: Number(row?.cnt ?? 0),
      lastRecordId: row?.last_id ?? undefined,
    });
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to seed bounded all dirty records: ${describeError(error)}`,
      })
    );
  }
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

/**
 * Materializes a propagation source relation (a pruned projection of this
 * frontier's dirty source rows) into a temp table before the propagation
 * select runs. Conditional filters correlate source rows against every target
 * row; without materialization the planner may re-evaluate the source scan —
 * including full-row before-image reconstruction — once per target row.
 */
type PropagationSourcePrepare = {
  execute: (db: Kysely<DynamicDB>) => Promise<void>;
};

type BuiltPropagationSelect = {
  query: DirtySelectQuery;
  runtimeAllTargetFallbackReason?: AllTargetRecordsReason;
  prepare?: PropagationSourcePrepare;
};

type PreparedPropagationSelect = {
  query: DirtySelectQuery;
  traceInfos: EdgeTraceInfo[];
  prepare?: PropagationSourcePrepare;
};

const fnv1aHex = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
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

const countDirtyRecords = async (db: Kysely<DynamicDB>): Promise<number> => {
  const result = await db
    .selectFrom(DIRTY_TABLE)
    .select(sql<number>`count(*)`.as('cnt'))
    .executeTakeFirst();
  return Number(result?.cnt ?? 0);
};

type PropagateDirtyOptions = {
  maxDirtyRecords?: number;
  /**
   * 'abort': stop at the budget and report exceeded (dirty state is unusable).
   * 'partial': stop at the budget but keep the materialized batch usable; the
   * budget then counts only propagated rows so seed-heavy tasks still progress.
   */
  dirtyBudgetMode?: 'abort' | 'partial';
  /** Ledger scope whose 'excluded' rows must be anti-joined out of targets. */
  exclusionScopeId?: string;
};

/**
 * Budgeted single-edge propagation insert. The CTE materializes at most `limit`
 * candidate rows (anti-joined against the dirty table, so every counted row is
 * genuinely new), inserts them, and returns the candidate count — no DISTINCT
 * over a giant UNION ALL, so executor memory stays bounded by `limit` plus the
 * edge's own join work instead of the whole fan-out.
 */
const runBudgetedPropagationInsert = async (
  db: Kysely<DynamicDB>,
  query: DirtySelectQuery,
  generation: number,
  limit: number,
  exclusionScopeId: string | undefined
): Promise<number> => {
  let src = db
    .selectFrom(query.as('propagated'))
    .select([
      sql.ref(`propagated.${DIRTY_TABLE_ID_COL}`).as(DIRTY_TABLE_ID_COL),
      sql.ref(`propagated.${DIRTY_RECORD_ID_COL}`).as(DIRTY_RECORD_ID_COL),
      sql.lit(generation + 1).as(DIRTY_GENERATION_COL),
    ])
    .where(
      sql<boolean>`not exists (
        select 1 from ${sql.table(DIRTY_TABLE)} as existing_dirty
        where existing_dirty.${sql.raw(DIRTY_TABLE_ID_COL)} = propagated.${sql.raw(DIRTY_TABLE_ID_COL)}
          and existing_dirty.${sql.raw(DIRTY_RECORD_ID_COL)} = propagated.${sql.raw(DIRTY_RECORD_ID_COL)}
      )`
    );
  if (exclusionScopeId !== undefined) {
    src = src.where(
      sql<boolean>`not exists (
        select 1 from ${sql.table(STAGE_LEDGER_TABLE)} as processed_target
        where processed_target.scope_id = ${exclusionScopeId}
          and processed_target.kind = 'excluded'
          and processed_target.table_id = propagated.${sql.raw(DIRTY_TABLE_ID_COL)}
          and processed_target.record_id = propagated.${sql.raw(DIRTY_RECORD_ID_COL)}
      )`
    );
  }
  src = src.limit(limit);

  const columnList = sql.raw(
    `${DIRTY_TABLE_ID_COL}, ${DIRTY_RECORD_ID_COL}, ${DIRTY_GENERATION_COL}`
  );
  const compiled = sql<{ cnt: number }>`
    with src as materialized (${src}),
    ins as (
      insert into ${sql.table(DIRTY_TABLE)} (${columnList})
      select ${columnList} from src
      on conflict (${sql.raw(`${DIRTY_TABLE_ID_COL}, ${DIRTY_RECORD_ID_COL}`)}) do nothing
    )
    select count(*)::int as cnt from src
  `.compile(db);

  const result = await db.executeQuery(compiled);
  return Number((result.rows[0] as { cnt?: number } | undefined)?.cnt ?? 0);
};

type QualifiedColumn = {
  schema: string;
  tableName: string;
  columnName: string;
};

const qualifiedColumnKey = (column: QualifiedColumn): string =>
  `${column.schema}.${column.tableName}.${column.columnName}`;

const splitQualifiedName = (qualified: string): { schema: string; tableName: string } => {
  const separator = qualified.indexOf('.');
  if (separator <= 0) {
    return { schema: 'public', tableName: qualified };
  }
  return {
    schema: qualified.slice(0, separator),
    tableName: qualified.slice(separator + 1),
  };
};

const resolveLinkPropagationJoinColumn = (
  linkField: LinkField,
  sourceTableName: string,
  targetTableName: string
): Result<QualifiedColumn | undefined, DomainError> => {
  return safeTry(function* () {
    const relationship = linkField.relationship();
    if (
      relationship.equals(LinkRelationship.manyOne()) ||
      relationship.equals(LinkRelationship.oneOne())
    ) {
      const fkHostTableName = yield* linkField.fkHostTableNameString();
      const foreignKey = yield* linkField.foreignKeyNameString();
      const selfKey = yield* linkField.selfKeyNameString();
      if (fkHostTableName === targetTableName) {
        if (foreignKey === '__id') return ok(undefined);
        const { schema, tableName } = splitQualifiedName(targetTableName);
        return ok({ schema, tableName, columnName: foreignKey });
      }
      if (selfKey === '__id') return ok(undefined);
      const { schema, tableName } = splitQualifiedName(sourceTableName);
      return ok({ schema, tableName, columnName: selfKey });
    }

    if (relationship.equals(LinkRelationship.oneMany())) {
      if (linkField.isOneWay()) {
        const fkHostTableName = yield* linkField.fkHostTableNameString();
        const foreignKey = yield* linkField.foreignKeyNameString();
        if (foreignKey === '__id') return ok(undefined);
        const { schema, tableName } = splitQualifiedName(fkHostTableName);
        return ok({ schema, tableName, columnName: foreignKey });
      }
      const selfKey = yield* linkField.selfKeyNameString();
      if (selfKey === '__id') return ok(undefined);
      const { schema, tableName } = splitQualifiedName(sourceTableName);
      return ok({ schema, tableName, columnName: selfKey });
    }

    const fkHostTableName = yield* linkField.fkHostTableNameString();
    const foreignKey = yield* linkField.foreignKeyNameString();
    if (foreignKey === '__id') return ok(undefined);
    const { schema, tableName } = splitQualifiedName(fkHostTableName);
    return ok({ schema, tableName, columnName: foreignKey });
  });
};

const collectLinkPropagationJoinColumns = (
  edges: ReadonlyArray<ComputedDependencyEdge>,
  tableById: Map<string, Table>
): Result<QualifiedColumn[], DomainError> => {
  return safeTry(function* () {
    const columns: QualifiedColumn[] = [];
    const seen = new Set<string>();
    for (const edge of edges) {
      if (edge.propagationMode === 'allTargetRecords') continue;
      if (edge.propagationMode === 'conditionalFiltered' && edge.filterCondition) continue;
      if (!edge.linkFieldId) continue;
      const targetTable = tableById.get(edge.toTableId.toString());
      const sourceTable = tableById.get(edge.fromTableId.toString());
      if (!targetTable || !sourceTable) continue;
      const linkFieldResult = targetTable.getField(
        (field): field is LinkField =>
          field.id().equals(edge.linkFieldId!) && field.type().equals(FieldType.link())
      );
      if (linkFieldResult.isErr()) continue;
      const linkField = linkFieldResult.value;
      if (!linkField.foreignTableId().equals(edge.fromTableId)) continue;
      const sourceDbName = yield* sourceTable.dbTableName().andThen((name) => name.value());
      const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());
      const join = yield* resolveLinkPropagationJoinColumn(linkField, sourceDbName, targetDbName);
      if (!join) continue;
      const key = qualifiedColumnKey(join);
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(join);
    }
    return ok(columns);
  });
};

const loadMissingJoinColumnKeys = async (
  db: Kysely<DynamicDB>,
  columns: ReadonlyArray<QualifiedColumn>
): Promise<Set<string>> => {
  const missing = new Set<string>();
  for (const column of columns) {
    try {
      const result = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = ${column.schema}
            AND table_name = ${column.tableName}
            AND column_name = ${column.columnName}
        ) as exists
      `.execute(db);
      if (result.rows[0]?.exists === false) {
        missing.add(qualifiedColumnKey(column));
      }
    } catch {
      // Keep the original SQL if catalog inspection fails so the run still
      // surfaces a real database error instead of silently dropping edges.
    }
  }
  return missing;
};

const propagateDirtyRecords = async (
  db: Kysely<DynamicDB>,
  edges: ReadonlyArray<ComputedDependencyEdge>,
  tableById: Map<string, Table>,
  context?: IExecutionContext,
  options?: PropagateDirtyOptions
): Promise<Result<DirtyPropagationStats, DomainError>> => {
  try {
    // Build trace info for all edges once
    const edgeTraceInfos = edges.map((edge, i) => buildEdgeTraceInfo(edge, i, tableById));
    const plannedAllTargetReasonCounts = countPlannedAllTargetReasonCounts(edges);
    const plannedAllTargetReasonSummary = summarizeAllTargetReasonCounts(
      plannedAllTargetReasonCounts
    );
    const joinColumnsResult = collectLinkPropagationJoinColumns(edges, tableById);
    if (joinColumnsResult.isErr()) {
      return err(joinColumnsResult.error);
    }
    const missingJoinKeys = await loadMissingJoinColumnKeys(db, joinColumnsResult.value);

    const runtimeAllTargetFallbackReasonCounts: AllTargetReasonCounts = {};

    const maxDirtyRecords =
      options?.maxDirtyRecords !== undefined && options.maxDirtyRecords > 0
        ? Math.trunc(options.maxDirtyRecords)
        : undefined;
    const partialMode = maxDirtyRecords !== undefined && options?.dirtyBudgetMode === 'partial';
    // Abort mode budgets the full dirty set (seeds included). Partial mode budgets
    // only rows this batch propagates, so seed-heavy tasks still make progress.
    let dirtyRecordTotal =
      maxDirtyRecords !== undefined && !partialMode ? await countDirtyRecords(db) : 0;
    let dirtyBudget: DirtyPropagationStats['dirtyBudget'];

    let maxFrontierGenerations = 1;

    for (
      let frontierGeneration = 0;
      frontierGeneration < maxFrontierGenerations;
      frontierGeneration += 1
    ) {
      // Multiple computed fields can share the same dirty-propagation path. Collapse
      // identical SELECTs for this frontier so we don't emit repeated UNION ALL branches.
      const preparedQueries = new Map<string, PreparedPropagationSelect>();
      for (const traceInfo of edgeTraceInfos) {
        const selectResult = buildPropagationSelect(
          db,
          traceInfo.edge,
          tableById,
          frontierGeneration,
          // Budget mode leaves dedup to ON CONFLICT so LIMIT can stop scans early.
          maxDirtyRecords === undefined,
          missingJoinKeys
        );
        if (selectResult.isErr()) {
          return err(selectResult.error);
        }

        if (frontierGeneration === 0) {
          incrementAllTargetReasonCount(
            runtimeAllTargetFallbackReasonCounts,
            selectResult.value.runtimeAllTargetFallbackReason
          );
        }

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
          ...(selectResult.value.prepare ? { prepare: selectResult.value.prepare } : {}),
        });
      }

      const selectQueries = [...preparedQueries.values()];
      if (frontierGeneration === 0) {
        maxFrontierGenerations = Math.max(selectQueries.length, 1);
      }
      if (selectQueries.length === 0) {
        break;
      }

      if (maxDirtyRecords !== undefined) {
        // Budgeted path: one bounded statement per edge instead of a single giant
        // UNION ALL — smaller executor footprint and an abort point between edges.
        let generationInserted = 0;
        for (const preparedSelect of selectQueries) {
          const remaining = maxDirtyRecords - dirtyRecordTotal;
          if (remaining <= 0) {
            dirtyBudget = partialMode
              ? {
                  status: 'partial',
                  propagatedDirtyRecords: dirtyRecordTotal,
                  truncated: 'propagation',
                }
              : { status: 'exceeded', dirtyRecordsAtAbort: dirtyRecordTotal };
            break;
          }
          // Abort mode probes one row past the budget to distinguish "exactly fits"
          // from "there was more"; partial mode caps at the budget exactly.
          const limit = partialMode ? remaining : remaining + 1;
          if (preparedSelect.prepare) {
            await preparedSelect.prepare.execute(db);
          }
          const srcCount = await runBudgetedPropagationInsert(
            db,
            preparedSelect.query,
            frontierGeneration,
            limit,
            options?.exclusionScopeId
          );
          generationInserted += srcCount;
          dirtyRecordTotal += srcCount;
          if (srcCount >= limit) {
            dirtyBudget = partialMode
              ? {
                  status: 'partial',
                  propagatedDirtyRecords: dirtyRecordTotal,
                  truncated: 'propagation',
                }
              : { status: 'exceeded', dirtyRecordsAtAbort: dirtyRecordTotal };
            break;
          }
        }
        if (dirtyBudget) break;
        if (generationInserted === 0) break;
        continue;
      }

      // Create a single span for the batched propagation
      const batchSpan = context?.tracer?.startSpan(
        'teable.ComputedFieldUpdater.propagateDirtyBatch',
        {
          'batch.pass': frontierGeneration,
          'batch.frontierGeneration': frontierGeneration,
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
        // Materialize conditional propagation sources before the combined
        // statement references them.
        for (const preparedSelect of selectQueries) {
          if (preparedSelect.prepare) {
            await preparedSelect.prepare.execute(db);
          }
        }
        // Build one UNION ALL over edges, but only from this pass's dirty frontier.
        let unionQuery = selectQueries[0].query;
        for (let i = 1; i < selectQueries.length; i++) {
          unionQuery = unionQuery.unionAll(selectQueries[i].query) as DirtySelectQuery;
        }

        const nextGenerationQuery = db
          .selectFrom(unionQuery.as('propagated'))
          .select([
            sql.ref(`propagated.${DIRTY_TABLE_ID_COL}`).as(DIRTY_TABLE_ID_COL),
            sql.ref(`propagated.${DIRTY_RECORD_ID_COL}`).as(DIRTY_RECORD_ID_COL),
            sql.lit(frontierGeneration + 1).as(DIRTY_GENERATION_COL),
          ]);
        const compiled = db
          .insertInto(DIRTY_TABLE)
          .columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL, DIRTY_GENERATION_COL])
          .expression(nextGenerationQuery)
          .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
          .compile();

        batchSpan?.setAttribute('batch.sql', compiled.sql);
        const result = await db.executeQuery(compiled);
        return toAffectedRowCount(result.numAffectedRows);
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
      ...(dirtyBudget ? { dirtyBudget } : {}),
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
  dirtyGeneration: number;
  /**
   * DISTINCT is a blocking executor node: under a dirty budget the per-edge LIMIT
   * must be able to stop the scan early, so dedup is left to ON CONFLICT instead.
   */
  distinct: boolean;
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
      dirtyGeneration,
      distinct,
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
          .where(`d.${DIRTY_GENERATION_COL}`, '=', dirtyGeneration)
          .select([
            sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
            sql.ref('t.__id').as(DIRTY_RECORD_ID_COL),
          ]);

        return ok((distinct ? select.distinct() : select) as unknown as DirtySelectQuery);
      }

      // Symmetric case: FK is on source table (fkHostTable = sourceTable)
      // The link field is on the "foreign" side of the relationship.
      // Join source table with dirty table, select selfKey as target record
      // (selfKey points to the target table records via the FK in source table)
      const select = db
        .selectFrom(`${sourceTableName} as s`)
        .innerJoin(`${DIRTY_TABLE} as d`, `d.${DIRTY_RECORD_ID_COL}`, 's.__id')
        .where(`d.${DIRTY_TABLE_ID_COL}`, '=', sourceTableId)
        .where(`d.${DIRTY_GENERATION_COL}`, '=', dirtyGeneration)
        .where(sql.ref(`s.${selfKey}`), 'is not', null)
        .select([
          sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
          sql.ref(`s.${selfKey}`).as(DIRTY_RECORD_ID_COL),
        ]);

      return ok((distinct ? select.distinct() : select) as unknown as DirtySelectQuery);
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
          .where(`d.${DIRTY_GENERATION_COL}`, '=', dirtyGeneration)
          .select([
            sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
            sql.ref(`j.${selfKey}`).as(DIRTY_RECORD_ID_COL),
          ]);

        return ok((distinct ? select.distinct() : select) as unknown as DirtySelectQuery);
      }

      const selfKey = yield* linkField.selfKeyNameString();
      const select = db
        .selectFrom(`${sourceTableName} as f`)
        .innerJoin(`${DIRTY_TABLE} as d`, `d.${DIRTY_RECORD_ID_COL}`, 'f.__id')
        .where(`d.${DIRTY_TABLE_ID_COL}`, '=', sourceTableId)
        .where(`d.${DIRTY_GENERATION_COL}`, '=', dirtyGeneration)
        .where(sql.ref(`f.${selfKey}`), 'is not', null)
        .select([
          sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
          sql.ref(`f.${selfKey}`).as(DIRTY_RECORD_ID_COL),
        ]);

      return ok((distinct ? select.distinct() : select) as unknown as DirtySelectQuery);
    }

    const fkHostTableName = yield* linkField.fkHostTableNameString();
    const selfKey = yield* linkField.selfKeyNameString();
    const foreignKey = yield* linkField.foreignKeyNameString();
    const select = db
      .selectFrom(`${fkHostTableName} as j`)
      .innerJoin(`${DIRTY_TABLE} as d`, `d.${DIRTY_RECORD_ID_COL}`, `j.${foreignKey}`)
      .where(`d.${DIRTY_TABLE_ID_COL}`, '=', sourceTableId)
      .where(`d.${DIRTY_GENERATION_COL}`, '=', dirtyGeneration)
      .select([
        sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
        sql.ref(`j.${selfKey}`).as(DIRTY_RECORD_ID_COL),
      ]);

    return ok((distinct ? select.distinct() : select) as unknown as DirtySelectQuery);
  });
};

const buildGatedAllTargetSelect = (
  db: Kysely<DynamicDB>,
  edge: Pick<ComputedDependencyEdge, 'fromTableId' | 'toTableId'>,
  targetDbName: string,
  dirtyGeneration: number,
  distinct: boolean
): DirtySelectQuery => {
  const dirtyGate = db
    .selectFrom(`${DIRTY_TABLE} as d`)
    .select(sql.ref(`d.${DIRTY_TABLE_ID_COL}`).as(DIRTY_TABLE_ID_COL))
    .where(`d.${DIRTY_TABLE_ID_COL}`, '=', edge.fromTableId.toString())
    .where(`d.${DIRTY_GENERATION_COL}`, '=', dirtyGeneration)
    .limit(1)
    .as('dg');

  const select = db
    .selectFrom(`${targetDbName} as t`)
    .innerJoin(dirtyGate, (join) => join.onTrue())
    .select([
      sql.lit(edge.toTableId.toString()).as(DIRTY_TABLE_ID_COL),
      sql.ref('t.__id').as(DIRTY_RECORD_ID_COL),
    ]);
  return (distinct ? select.distinct() : select) as unknown as DirtySelectQuery;
};

const skippedPropagationSelect = (
  db: Kysely<DynamicDB>,
  edge: ComputedDependencyEdge,
  distinct: boolean
): BuiltPropagationSelect => {
  const select = db
    .selectFrom(DIRTY_TABLE)
    .select([
      sql.lit(edge.toTableId.toString()).as(DIRTY_TABLE_ID_COL),
      sql.ref(DIRTY_RECORD_ID_COL).as(DIRTY_RECORD_ID_COL),
    ])
    .where(sql<SqlBool>`false`);
  return {
    query: (distinct ? select.distinct() : select) as unknown as DirtySelectQuery,
  };
};

/**
 * Build a SELECT query for dirty record propagation (without INSERT wrapper).
 * This allows combining multiple SELECT queries with UNION ALL.
 */
const buildPropagationSelect = (
  db: Kysely<DynamicDB>,
  edge: ComputedDependencyEdge,
  tableById: Map<string, Table>,
  dirtyGeneration: number,
  distinct: boolean,
  missingJoinKeys: ReadonlySet<string> = new Set()
): Result<BuiltPropagationSelect, DomainError> => {
  return safeTry(function* () {
    const targetTable = tableById.get(edge.toTableId.toString());
    if (!targetTable) {
      return ok(skippedPropagationSelect(db, edge, distinct));
    }

    if (edge.propagationMode === 'allTargetRecords') {
      const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());
      const select = buildGatedAllTargetSelect(db, edge, targetDbName, dirtyGeneration, distinct);

      return ok({ query: select as unknown as DirtySelectQuery });
    }

    // conditionalFiltered: Only mark target records as dirty if dirty source records match the filter
    if (edge.propagationMode === 'conditionalFiltered' && edge.filterCondition) {
      const sourceTable = tableById.get(edge.fromTableId.toString());
      if (!sourceTable) {
        return ok(skippedPropagationSelect(db, edge, distinct));
      }

      // Create FieldCondition from filterDto
      const fieldConditionResult = FieldCondition.create({
        filter: edge.filterCondition.filterDto,
      });
      if (fieldConditionResult.isErr()) {
        // Fallback to allTargetRecords if filter is invalid
        const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());
        return ok({
          query: buildGatedAllTargetSelect(db, edge, targetDbName, dirtyGeneration, distinct),
          runtimeAllTargetFallbackReason: 'conditional_runtime_invalid_filter',
        });
      }

      const fieldCondition = fieldConditionResult.value;
      if (!fieldCondition.hasFilter()) {
        // No filter - fallback to allTargetRecords
        const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());
        return ok({
          query: buildGatedAllTargetSelect(db, edge, targetDbName, dirtyGeneration, distinct),
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
          query: buildGatedAllTargetSelect(db, edge, targetDbName, dirtyGeneration, distinct),
          runtimeAllTargetFallbackReason: 'conditional_runtime_invalid_condition_spec',
        });
      }
      const specResult = conditionSpecResult.value;
      if (!specResult) {
        // No spec generated - fallback to allTargetRecords
        const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());
        return ok({
          query: buildGatedAllTargetSelect(db, edge, targetDbName, dirtyGeneration, distinct),
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

      // Project only the source columns the filter references (plus __id for
      // record-id conditions). The wide source row is dead weight for matching,
      // and the before-image branch otherwise reconstructs it in full — per
      // target row — via jsonb_populate_record.
      // referencedFieldIds() (not filterFieldIds()) because for self-table
      // field references toRecordConditionSpec swaps the item field to the
      // host side and puts the referenced field on the source alias; host-only
      // field ids simply fail the source-table lookup below and are skipped.
      const sourceColumns = new Set<string>(['__id']);
      for (const fieldId of fieldCondition.referencedFieldIds()) {
        const fieldResult = sourceTable.getField((f) => f.id().equals(fieldId));
        if (fieldResult.isErr()) continue;
        const columnResult = fieldResult.value.dbFieldName().andThen((name) => name.value());
        if (columnResult.isErr()) continue;
        sourceColumns.add(columnResult.value);
      }
      const prunedColumns = [...sourceColumns];

      const currentSourceRows = db
        .selectFrom(`${DIRTY_TABLE} as d`)
        .innerJoin(`${sourceDbName} as s`, 's.__id', `d.${DIRTY_RECORD_ID_COL}`)
        .select(prunedColumns.map((column) => sql.ref(`s.${column}`).as(column)))
        .where(`d.${DIRTY_TABLE_ID_COL}`, '=', edge.fromTableId.toString())
        .where(`d.${DIRTY_GENERATION_COL}`, '=', dirtyGeneration);

      let sourceRowsQuery = currentSourceRows;

      if (edge.filterCondition.includeBeforeImage) {
        const sourceTableTypeLiteral = toQualifiedIdentifierLiteral(sourceDbName);

        const beforeImageRows = db
          .selectFrom(`${DIRTY_TABLE} as d`)
          .innerJoin(`${BEFORE_IMAGE_TABLE} as bi`, (join) =>
            join
              .onRef(`bi.${DIRTY_TABLE_ID_COL}`, '=', `d.${DIRTY_TABLE_ID_COL}`)
              .onRef(`bi.${DIRTY_RECORD_ID_COL}`, '=', `d.${DIRTY_RECORD_ID_COL}`)
          )
          .leftJoin(`${sourceDbName} as s_current`, 's_current.__id', `d.${DIRTY_RECORD_ID_COL}`)
          .innerJoinLateral(
            sql<Record<string, unknown>>`(
              select *
              -- Reconstruct the pre-change source row by starting from the current row
              -- (or an empty JSON object for DELETE) and overlaying the captured old column values.
              from jsonb_populate_record(
                null::${sql.raw(sourceTableTypeLiteral)},
                coalesce(to_jsonb(${sql.raw(quoteIdentifier('s_current'))}), '{}'::jsonb)
                  || ${sql.ref(`bi.${BEFORE_IMAGE_SNAPSHOT_COL}`)}
              )
            )`.as('s_before'),
            (join) => join.onTrue()
          )
          .select(prunedColumns.map((column) => sql.ref(`s_before.${column}`).as(column)))
          .where(`d.${DIRTY_TABLE_ID_COL}`, '=', edge.fromTableId.toString())
          .where(`d.${DIRTY_GENERATION_COL}`, '=', dirtyGeneration);

        sourceRowsQuery = currentSourceRows.unionAll(
          beforeImageRows as unknown as typeof currentSourceRows
        ) as unknown as typeof currentSourceRows;
      }

      // Materialize the (small, budget-bounded) source rows once per statement.
      // Left as a correlated EXISTS, the planner can re-run the source scan —
      // including the before-image full-row rebuild — once per target row,
      // which is the O(targets × dirty) shape behind minute-long propagation
      // statements in production.
      const compiledSourceRows = sourceRowsQuery.compile();
      const sourceRelationName = `tmp_computed_csrc_${fnv1aHex(
        `${compiledSourceRows.sql}::${JSON.stringify(compiledSourceRows.parameters)}`
      )}`;
      const prepare: PropagationSourcePrepare = {
        execute: async (runDb) => {
          await sql`drop table if exists ${sql.table(`pg_temp.${sourceRelationName}`)}`.execute(
            runDb
          );
          await sql`create temp table ${sql.raw(
            quoteIdentifier(sourceRelationName)
          )} on commit drop as ${sourceRowsQuery}`.execute(runDb);
          await sql`analyze ${sql.table(`pg_temp.${sourceRelationName}`)}`.execute(runDb);
        },
      };

      const matchSubquery = db
        .selectFrom(`pg_temp.${sourceRelationName} as s`)
        .select(sql.lit(1).as('one'))
        .where(filterWhere)
        .limit(1);

      const targetDrivenSelect = db
        .selectFrom(`${targetDbName} as t`)
        .select([
          sql.lit(edge.toTableId.toString()).as(DIRTY_TABLE_ID_COL),
          sql.ref('t.__id').as(DIRTY_RECORD_ID_COL),
        ])
        .where(sql<SqlBool>`exists (${matchSubquery})`);

      return ok({
        query: (distinct
          ? targetDrivenSelect.distinct()
          : targetDrivenSelect) as unknown as DirtySelectQuery,
        prepare,
      });
    }

    if (!edge.linkFieldId) return err(domainError.validation({ message: 'Missing linkFieldId' }));
    const sourceTable = tableById.get(edge.fromTableId.toString());
    if (!sourceTable) {
      return ok(skippedPropagationSelect(db, edge, distinct));
    }

    const linkFieldResult = targetTable.getField(
      (field): field is LinkField =>
        field.id().equals(edge.linkFieldId!) && field.type().equals(FieldType.link())
    );
    if (linkFieldResult.isErr()) {
      // Schema updates/undo-redo (or a persisted plan whose linkFieldId
      // drifted onto a lookup/rollup) may leave transient stale edges.
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

    const joinColumn = yield* resolveLinkPropagationJoinColumn(
      linkField,
      sourceDbName,
      targetDbName
    );
    if (joinColumn && missingJoinKeys.has(qualifiedColumnKey(joinColumn))) {
      return ok(skippedPropagationSelect(db, edge, distinct));
    }

    const relationship = linkField.relationship();
    const selectQuery = yield* buildDirtySelectQuery({
      db,
      relationship,
      linkField,
      sourceTableName: sourceDbName,
      targetTableName: targetDbName,
      sourceTableId: edge.fromTableId.toString(),
      targetTableId: edge.toTableId.toString(),
      dirtyGeneration,
      distinct,
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
