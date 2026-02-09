import type {
  BaseId,
  FieldId,
  Table,
  TableId,
  DomainError,
  IExecutionContext,
  IHasher,
  ILogger,
  IEventBus,
} from '@teable/v2-core';
import {
  v2CoreTokens,
  TableId as CoreTableId,
  RecordsBatchUpdated,
  FieldType,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type {
  ComputedFieldUpdater,
  ComputedUpdateResult,
  PreparedDirtyState,
  StepChangeData,
} from '../ComputedFieldUpdater';
import type {
  ComputedSeedGroup,
  ComputedUpdatePlan,
  UpdateStep,
  ComputedUpdatePlanner,
} from '../ComputedUpdatePlanner';
import { splitSeedGroupsForPlan } from '../ComputedUpdatePlanner';
import {
  createComputedUpdateRun,
  toRunLogContext,
  toRunSpanAttributes,
} from '../ComputedUpdateRun';
import { buildOutboxTaskInput } from '../outbox/ComputedUpdateOutboxPayload';
import type { IComputedUpdateOutbox } from '../outbox/IComputedUpdateOutbox';
import type { ComputedUpdateWorker } from '../worker/ComputedUpdateWorker';
import type { IUpdateStrategy, UpdateStrategyMode } from './IUpdateStrategy';

/**
 * Dispatch mode for async computed updates:
 *
 * - `push`: Inline dispatch after enqueue with configurable delay.
 *           Fast but has race condition if delay is too short.
 *           Use `dispatchDelayMs >= 50` to allow transaction commit.
 *
 * - `external`: No inline dispatch - relies on external worker polling.
 *               Most reliable, recommended for production.
 *               Latency depends on worker poll interval.
 *
 * - `hybrid`: Push with external fallback. Tries inline dispatch
 *             but external worker catches any missed tasks.
 *             Best of both worlds for production with low latency.
 */
export type DispatchMode = 'push' | 'external' | 'hybrid';

export type HybridWithOutboxStrategyConfig = {
  syncPolicy: 'seedTableOnly' | 'threshold';
  syncMaxDirtyPerTable: number;
  syncMaxTotalDirty: number;
  syncMaxLevelHardCap: number;

  /**
   * Dispatch mode for async tasks.
   * @see DispatchMode
   */
  dispatchMode: DispatchMode;

  /**
   * Worker batch size for inline dispatch.
   * Only used when dispatchMode is 'push' or 'hybrid'.
   */
  dispatchWorkerLimit: number;

  /**
   * Worker ID for inline dispatch.
   */
  dispatchWorkerId: string;

  /**
   * Delay before inline dispatch (ms).
   * Set to >= 50ms to avoid race condition with transaction commit.
   * Only used when dispatchMode is 'push' or 'hybrid'.
   */
  dispatchDelayMs: number;
};

export const defaultHybridWithOutboxStrategyConfig: HybridWithOutboxStrategyConfig = {
  syncPolicy: 'seedTableOnly',
  syncMaxDirtyPerTable: 2000,
  syncMaxTotalDirty: 5000,
  syncMaxLevelHardCap: 1,
  // Default to 'push' with 50ms delay for safety
  dispatchMode: 'push',
  dispatchWorkerLimit: 50,
  dispatchWorkerId: 'computed-inline',
  dispatchDelayMs: 50, // Changed from 0 to 50 to avoid race condition
};

/**
 * Production-recommended config: external worker handles all async tasks.
 */
export const productionHybridWithOutboxStrategyConfig: HybridWithOutboxStrategyConfig = {
  ...defaultHybridWithOutboxStrategyConfig,
  dispatchMode: 'external', // Rely on external worker polling
};

/**
 * Low-latency config: hybrid mode with short delay.
 * External worker as backup for reliability.
 */
export const lowLatencyHybridWithOutboxStrategyConfig: HybridWithOutboxStrategyConfig = {
  ...defaultHybridWithOutboxStrategyConfig,
  dispatchMode: 'hybrid',
  dispatchDelayMs: 50,
};

/**
 * Hybrid strategy: sync dependency-safe levels, enqueue heavy levels to outbox.
 *
 * Example
 * ```typescript
 * const strategy = new HybridWithOutboxStrategy(outbox, worker, config, logger);
 * await strategy.execute(updater, plan, context);
 * ```
 */
@injectable()
export class HybridWithOutboxStrategy implements IUpdateStrategy {
  readonly name = 'hybrid';
  readonly mode: UpdateStrategyMode = 'hybrid';

  constructor(
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateOutbox)
    private readonly outbox: IComputedUpdateOutbox,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateWorker)
    private readonly worker: ComputedUpdateWorker,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateHybridConfig)
    private readonly config: HybridWithOutboxStrategyConfig = defaultHybridWithOutboxStrategyConfig,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2CoreTokens.hasher)
    private readonly hasher: IHasher,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly planner: ComputedUpdatePlanner,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: IEventBus
  ) {}

  private dispatchTimer: ReturnType<typeof setTimeout> | null = null;
  private dispatchInFlight = false;

  async execute(
    updater: ComputedFieldUpdater,
    plan: ComputedUpdatePlan,
    context: IExecutionContext
  ): Promise<Result<ComputedUpdateResult | undefined, DomainError>> {
    if (
      plan.steps.length === 0 ||
      (plan.seedRecordIds.length === 0 && plan.extraSeedRecords.length === 0)
    ) {
      return ok(undefined);
    }

    let currentPlan = plan;
    let completedSteps = 0;
    let totalSteps = currentPlan.steps.length;
    const baseRun = createComputedUpdateRun({
      totalSteps,
      completedStepsBefore: 0,
      phase: 'full',
    });
    const runId = baseRun.runId;
    const originRunIds = baseRun.originRunIds;

    // Track already-updated fields to prevent duplicate updates across stages.
    // Without this, computed fields in the dependency chain would be updated multiple times
    // because collectStepFieldIds passes them as changedFieldIds to the next stage.
    const updatedFieldIds = new Set<string>();

    // Accumulate sync changes from all stages
    const allSyncChangesByStep: StepChangeData[] = [];

    while (currentPlan.steps.length > 0) {
      const prepared = await updater.prepareDirtyState(currentPlan, context);
      if (prepared.isErr()) return err(prepared.error);

      const { syncSteps, asyncSteps, syncMaxLevel } = splitStepsByPolicy(
        currentPlan,
        prepared.value,
        this.config
      );

      const phase = asyncSteps.length === 0 ? 'full' : 'sync';
      const run = createComputedUpdateRun({
        runId,
        originRunIds,
        totalSteps,
        completedStepsBefore: completedSteps,
        phase,
      });
      const lockResult = await updater.acquireLocks(currentPlan, context, {
        logContext: toRunLogContext(run),
      });
      if (lockResult.isErr()) return err(lockResult.error);

      const runLogger = this.logger.child(toRunLogContext(run));

      runLogger.info('computed:run:start', {
        baseId: currentPlan.baseId.toString(),
        seedTableId: currentPlan.seedTableId.toString(),
        changeType: currentPlan.changeType,
        totalSteps,
        syncStepCount: syncSteps.length,
        asyncStepCount: asyncSteps.length,
        pendingSteps: Math.max(totalSteps - completedSteps, 0),
      });

      // Log detailed plan for debugging and testing (e.g., SpyLogger captures this)
      runLogger.debug('computed:plan', {
        baseId: currentPlan.baseId.toString(),
        seedTableId: currentPlan.seedTableId.toString(),
        seedRecordIds: currentPlan.seedRecordIds.map((r) => r.toString()),
        steps: currentPlan.steps.map((s) => ({
          tableId: s.tableId.toString(),
          level: s.level,
          fieldIds: s.fieldIds.map((f) => f.toString()),
        })),
        edges: currentPlan.edges.map((e) => ({
          from: `${e.fromTableId.toString()}.${e.fromFieldId.toString()}`,
          to: `${e.toTableId.toString()}.${e.toFieldId.toString()}`,
          linkFieldId: e.linkFieldId?.toString(),
          propagationMode: e.propagationMode,
          hasFilterCondition: !!e.filterCondition,
          order: e.order,
        })),
        sameTableBatches: currentPlan.sameTableBatches.map((b) => ({
          tableId: b.tableId.toString(),
          stepCount: b.steps.length,
          minLevel: b.minLevel,
          maxLevel: b.maxLevel,
          fieldCount: b.steps.reduce((acc, s) => acc + s.fieldIds.length, 0),
        })),
      });

      const runSpan = context.tracer?.startSpan('teable.ComputedUpdateRun', {
        ...toRunSpanAttributes(run),
        'computed.baseId': currentPlan.baseId.toString(),
        'computed.seedTableId': currentPlan.seedTableId.toString(),
        'computed.changeType': currentPlan.changeType,
      });

      const syncWork = async () =>
        updater.executePreparedSteps(currentPlan, context, prepared.value, syncSteps, run, true);
      const syncResult =
        runSpan && context.tracer
          ? await context.tracer.withSpan(runSpan, syncWork)
          : await syncWork();
      runSpan?.end();
      if (syncResult.isErr()) return err(syncResult.error);

      // Accumulate sync changes from this stage
      allSyncChangesByStep.push(...syncResult.value.changesByStep);

      // Publish events for computed updates
      const events = buildComputedUpdateEvents(syncResult.value.changesByStep, currentPlan.baseId);
      if (events.length > 0) {
        const publishResult = await this.eventBus.publishMany(context, events);
        if (publishResult.isErr()) {
          runLogger.warn('computed:events:publish_failed', {
            error: publishResult.error.message,
            eventCount: events.length,
          });
        } else {
          runLogger.debug('computed:events:published', {
            eventCount: events.length,
            tableIds: [...new Set(events.map((e) => e.tableId.toString()))],
          });
        }
      }

      completedSteps += syncSteps.length;

      // Record updated fields to avoid re-updating them in subsequent stages
      for (const step of syncSteps) {
        for (const fieldId of step.fieldIds) {
          updatedFieldIds.add(fieldId.toString());
        }
      }

      if (asyncSteps.length > 0) {
        const stageFieldIds = collectStepFieldIds(currentPlan);
        const stageTableIds = collectStepTableIds(currentPlan);
        runLogger.info('computed:run:phase_done', {
          phase: 'sync',
          completedSteps,
          pendingSteps: Math.max(totalSteps - completedSteps, 0),
          asyncStepCount: asyncSteps.length,
        });

        const asyncPlan: ComputedUpdatePlan = {
          ...currentPlan,
          steps: asyncSteps,
        };

        const task = buildOutboxTaskInput({
          plan: asyncPlan,
          dirtyStats: prepared.value.dirtyStats,
          syncMaxLevel,
          hasher: this.hasher,
          runId,
          originRunIds: [...originRunIds],
          runTotalSteps: totalSteps,
          runCompletedStepsBefore: completedSteps,
          affectedFieldIds: stageFieldIds.map((id) => id.toString()),
          affectedTableIds: stageTableIds.map((id) => id.toString()),
        });

        const enqueueResult = await this.outbox.enqueueOrMerge(task, context);
        if (enqueueResult.isErr()) {
          runLogger.warn('computed:outbox:enqueue_failed', {
            error: enqueueResult.error.message,
            planHash: task.planHash,
          });
          return err(enqueueResult.error);
        }

        runLogger.debug('computed:outbox:enqueued', {
          taskId: enqueueResult.value.taskId,
          merged: enqueueResult.value.merged,
          asyncStepCount: asyncSteps.length,
        });

        runLogger.info('computed:run:queued', {
          taskId: enqueueResult.value.taskId,
          pendingSteps: asyncSteps.length,
          asyncStepCount: asyncSteps.length,
        });

        this.scheduleDispatch(context);
        // Return sync portion changes even when async steps are queued
        return ok({ changesByStep: allSyncChangesByStep });
      }

      runLogger.info('computed:run:done', {
        completedSteps,
        pendingSteps: 0,
      });

      const nextSeedFieldIds = collectStepFieldIds(currentPlan);
      const tableIds = collectStepTableIds(currentPlan);
      const seedGroups = await updater.collectDirtySeedGroups(context, tableIds);
      if (seedGroups.isErr()) return err(seedGroups.error);

      const nextPlanResult = await this.planNextStage(
        currentPlan,
        context,
        nextSeedFieldIds,
        seedGroups.value
      );
      if (nextPlanResult.isErr()) return err(nextPlanResult.error);

      // Filter out already-updated fields from the next plan's steps
      const filteredSteps = nextPlanResult.value.steps
        .map((step) => ({
          ...step,
          fieldIds: step.fieldIds.filter((id) => !updatedFieldIds.has(id.toString())),
        }))
        .filter((step) => step.fieldIds.length > 0);

      if (filteredSteps.length === 0) break;

      currentPlan = { ...nextPlanResult.value, steps: filteredSteps };
      totalSteps += currentPlan.steps.length;
    }

    return ok({ changesByStep: allSyncChangesByStep });
  }

  scheduleDispatch(context: IExecutionContext): void {
    // 'external' mode: no inline dispatch, rely on external worker polling
    if (this.config.dispatchMode === 'external') {
      this.logger.debug('computed:outbox:dispatch_skipped', {
        reason: 'external_mode',
        message: 'Task enqueued, waiting for external worker to poll',
      });
      return;
    }

    // 'push' or 'hybrid' mode: schedule inline dispatch
    if (this.dispatchTimer) return;

    // Strip transaction so async work runs after commit on a fresh connection.
    // Preserve requestId for ShareDB src matching.
    const dispatchContext: IExecutionContext = {
      actorId: context.actorId,
      tracer: context.tracer,
      requestId: context.requestId,
    };

    // Use delay to ensure transaction has committed before dispatch
    const delay = this.config.dispatchDelayMs;
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = null;
      void this.drainOutbox(dispatchContext);
    }, delay);

    this.logger.debug('computed:outbox:dispatch_scheduled', {
      mode: this.config.dispatchMode,
      delayMs: delay,
    });
  }

  private async drainOutbox(context: IExecutionContext): Promise<void> {
    if (this.dispatchInFlight) return;
    this.dispatchInFlight = true;
    try {
      const limit = this.config.dispatchWorkerLimit;
      const workerId = this.config.dispatchWorkerId;

      let shouldContinue = true;
      while (shouldContinue) {
        const result = await this.worker.runOnce({
          workerId,
          limit,
          actorId: context.actorId,
          tracer: context.tracer,
          requestId: context.requestId,
        });

        if (result.isErr()) {
          this.logger.warn('computed:outbox:dispatch_failed', { error: result.error.message });
          shouldContinue = false;
          continue;
        }

        if (result.value < limit) {
          shouldContinue = false;
        }
      }
    } finally {
      this.dispatchInFlight = false;
    }
  }

  private async planNextStage(
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    seedFieldIds: ReadonlyArray<FieldId>,
    seedGroups: ReadonlyArray<ComputedSeedGroup>
  ): Promise<Result<ComputedUpdatePlan, DomainError>> {
    if (plan.edges.length === 0) return ok({ ...plan, steps: [], edges: [] });
    if (seedFieldIds.length === 0) return ok({ ...plan, steps: [], edges: [] });

    const seedSplit = splitSeedGroupsForPlan(seedGroups, plan.seedTableId);
    if (!seedSplit) return ok({ ...plan, steps: [], edges: [] });

    return this.planner.planStage(
      {
        baseId: plan.baseId,
        seedTableId: seedSplit.seedTableId,
        seedRecordIds: seedSplit.seedRecordIds,
        extraSeedRecords: seedSplit.extraSeedRecords,
        changedFieldIds: seedFieldIds,
        changeType: plan.changeType,
        cyclePolicy: plan.cyclePolicy,
        impact: {
          valueFieldIds: seedFieldIds,
          linkFieldIds: [],
        },
      },
      context
    );
  }
}

const collectStepFieldIds = (plan: ComputedUpdatePlan): FieldId[] => {
  const ids = new Map<string, FieldId>();
  for (const step of plan.steps) {
    for (const fieldId of step.fieldIds) {
      ids.set(fieldId.toString(), fieldId);
    }
  }
  return [...ids.values()];
};

const collectStepTableIds = (plan: ComputedUpdatePlan): TableId[] => {
  const ids = new Map<string, TableId>();
  for (const step of plan.steps) {
    ids.set(step.tableId.toString(), step.tableId);
  }
  // Also collect tableIds from propagation edges (for cross-base symmetric links)
  for (const edge of plan.edges) {
    ids.set(edge.fromTableId.toString(), edge.fromTableId);
    ids.set(edge.toTableId.toString(), edge.toTableId);
  }
  return [...ids.values()];
};

const splitStepsByPolicy = (
  plan: ComputedUpdatePlan,
  prepared: PreparedDirtyState,
  config: HybridWithOutboxStrategyConfig
): {
  syncSteps: ReadonlyArray<UpdateStep>;
  asyncSteps: ReadonlyArray<UpdateStep>;
  syncMaxLevel: number;
} => {
  const seedTableId = plan.seedTableId.toString();

  const isFormulaOnlyStep = (step: UpdateStep, tableById: Map<string, Table>): boolean => {
    if (step.fieldIds.length === 0) return false;
    const table = tableById.get(step.tableId.toString());
    if (!table) return false;
    for (const fieldId of step.fieldIds) {
      const fieldResult = table.getField((field) => field.id().equals(fieldId));
      if (fieldResult.isErr()) return false;
      if (!fieldResult.value.type().equals(FieldType.formula())) return false;
    }
    return true;
  };

  const syncStepKey = (step: UpdateStep): string => `${step.tableId.toString()}|${step.level}`;

  if (config.syncPolicy === 'seedTableOnly') {
    const syncSteps = plan.steps.filter(
      (step) =>
        step.tableId.toString() === seedTableId && isFormulaOnlyStep(step, prepared.tableById)
    );
    const syncStepKeys = new Set(syncSteps.map(syncStepKey));
    const asyncSteps = plan.steps.filter((step) => !syncStepKeys.has(syncStepKey(step)));
    const syncMaxLevel = syncSteps.reduce((acc, step) => Math.max(acc, step.level), -1);
    return { syncSteps, asyncSteps, syncMaxLevel };
  }

  const maxLevel = plan.steps.reduce((acc, step) => Math.max(acc, step.level), -1);
  const seedTableMaxLevel = plan.steps
    .filter((step) => step.tableId.toString() === seedTableId)
    .reduce((acc, step) => Math.max(acc, step.level), -1);

  const levelHardCap = Math.max(seedTableMaxLevel, config.syncMaxLevelHardCap);

  const dirtyCountByTable = new Map(
    prepared.dirtyStats.map((stat) => [stat.tableId, stat.recordCount])
  );

  let syncMaxLevel = seedTableMaxLevel;
  let cumulativeDirty = 0;

  for (let level = seedTableMaxLevel + 1; level <= maxLevel; level += 1) {
    if (level > levelHardCap) break;

    const levelSteps = plan.steps.filter((step) => step.level === level);
    if (levelSteps.length === 0) {
      syncMaxLevel = level;
      continue;
    }

    const tableIds = new Set(levelSteps.map((step) => step.tableId.toString()));
    let levelTotal = 0;
    let levelMax = 0;
    for (const tableId of tableIds) {
      const count = dirtyCountByTable.get(tableId) ?? 0;
      levelTotal += count;
      levelMax = Math.max(levelMax, count);
    }

    cumulativeDirty += levelTotal;

    if (levelMax > config.syncMaxDirtyPerTable) break;
    if (cumulativeDirty > config.syncMaxTotalDirty) break;

    syncMaxLevel = level;
  }

  const syncSteps = plan.steps.filter((step) => step.level <= syncMaxLevel);
  const asyncSteps = plan.steps.filter((step) => step.level > syncMaxLevel);

  return { syncSteps, asyncSteps, syncMaxLevel };
};

/**
 * Build RecordsBatchUpdated events from step change data.
 * Groups changes by tableId and creates one event per table.
 */
const buildComputedUpdateEvents = (
  changesByStep: ReadonlyArray<StepChangeData>,
  baseId: BaseId
): RecordsBatchUpdated[] => {
  if (changesByStep.length === 0) return [];

  // Group changes by tableId
  const changesByTable = new Map<string, StepChangeData['recordChanges']>();
  for (const stepChange of changesByStep) {
    const existing = changesByTable.get(stepChange.tableId) ?? [];
    changesByTable.set(stepChange.tableId, [...existing, ...stepChange.recordChanges]);
  }

  const events: RecordsBatchUpdated[] = [];

  for (const [tableIdStr, recordChanges] of changesByTable) {
    if (recordChanges.length === 0) continue;

    const tableIdResult = CoreTableId.create(tableIdStr);
    if (tableIdResult.isErr()) continue;

    // Convert recordChanges to RecordUpdateDTO format
    // Use actual oldVersion from computed update (version before update)
    const updates = recordChanges.map((change) => ({
      recordId: change.recordId,
      oldVersion: change.oldVersion,
      newVersion: change.oldVersion + 1,
      changes: change.changes.map((fieldChange) => ({
        fieldId: fieldChange.fieldId,
        oldValue: null as unknown,
        newValue: fieldChange.newValue,
      })),
    }));

    events.push(
      RecordsBatchUpdated.create({
        tableId: tableIdResult.value,
        baseId,
        updates,
        source: 'computed',
      })
    );
  }

  return events;
};
