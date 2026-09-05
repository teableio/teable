import type {
  BaseId,
  FieldId,
  TableId,
  DomainError,
  IBatchMutationOrchestration,
  IExecutionContext,
  IHasher,
  ILogger,
  IEventBus,
} from '@teable/v2-core';
import {
  v2CoreTokens,
  TableId as CoreTableId,
  RecordsBatchUpdated,
  registerAfterCommit,
  withoutTransaction,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import {
  buildBeforeImageRecordsFromStepChanges,
  mergeBeforeImageRecords,
} from '../ComputedBeforeImageFromChanges';
import { collectContinuationFieldIds } from '../ComputedContinuationFields';
import type {
  ComputedFieldUpdater,
  ComputedUpdateResult,
  PreparedDirtyState,
  StepChangeData,
} from '../ComputedFieldUpdater';
import { isComputedUpdateLockUnavailable } from '../ComputedUpdateLock';
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
import {
  defaultComputedUpdateRuntimeConfig,
  type ComputedUpdateRuntimeConfig,
} from '../ComputedUpdateRuntimeConfig';
import { withInlineComputedStatementTimeout } from '../ComputedUpdateTransactionSettings';
import { buildOutboxTaskInput } from '../outbox/ComputedUpdateOutboxPayload';
import { buildSeedTaskInput } from '../outbox/ComputedUpdateSeedPayload';
import type { EnqueueOrMergeOutcome, IComputedUpdateOutbox } from '../outbox/IComputedUpdateOutbox';
import { pushAll } from '../pushAll';
import type { IComputedUpdatePauseRegistry } from '../pause/IComputedUpdatePauseRegistry';
import { noopComputedUpdatePauseRegistry } from '../pause/IComputedUpdatePauseRegistry';
import type { ComputedUpdateWorker } from '../worker/ComputedUpdateWorker';
import type {
  IUpdateStrategy,
  UpdateStrategyExecuteOptions,
  UpdateStrategyMode,
} from './IUpdateStrategy';

/**
 * Dispatch mode for async computed updates:
 *
 * - `push`: Inline dispatch after enqueue with configurable delay.
 *           Fast but has race condition if delay is too short.
 *           Use `dispatchDelayMs >= 50` to allow transaction commit.
 *
 * - `external`: No inline dispatch - relies on an external wake-up worker.
 *               Recommended when BullMQ owns asynchronous delivery.
 *
 * - `hybrid`: Push plus external delivery. Tries inline dispatch while
 *             the external worker handles queued wake-ups.
 */
export type DispatchMode = 'push' | 'external' | 'hybrid';

export type HybridWithOutboxStrategyConfig = {
  syncPolicy: 'none' | 'seedTableOnly' | 'threshold';
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
  // Default to external BullMQ delivery for restart-safe production behavior.
  dispatchMode: 'external',
  dispatchWorkerLimit: 50,
  dispatchWorkerId: 'computed-inline',
  dispatchDelayMs: 50,
};

const maxComputedEventLogItems = 10;
const maxComputedEventLogFieldIds = 20;
const maxComputedEventLogRecordIds = 10;

const wholeTableAsyncReason = (
  plan: ComputedUpdatePlan
): 'seed_all_table' | 'all_target_records' | undefined => {
  if ((plan.seedAllTableIds?.length ?? 0) > 0) return 'seed_all_table';
  if (plan.edges.some((edge) => edge.propagationMode === 'allTargetRecords')) {
    return 'all_target_records';
  }
  return undefined;
};

/**
 * Production-recommended config: external worker handles all async tasks.
 */
export const productionHybridWithOutboxStrategyConfig: HybridWithOutboxStrategyConfig = {
  ...defaultHybridWithOutboxStrategyConfig,
  dispatchMode: 'external', // Rely on the external wake-up worker
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
    private readonly eventBus: IEventBus,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateRuntimeConfig)
    private readonly runtimeConfig: ComputedUpdateRuntimeConfig = defaultComputedUpdateRuntimeConfig,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePauseRegistry)
    private readonly pauseRegistry: IComputedUpdatePauseRegistry = noopComputedUpdatePauseRegistry
  ) {}

  private dispatchTimer: ReturnType<typeof setTimeout> | null = null;
  private dispatchInFlight = false;

  private async enqueuePlan(
    task: ReturnType<typeof buildOutboxTaskInput>,
    context: IExecutionContext,
    runLogger: ILogger,
    details: {
      pendingSteps: number;
      asyncStepCount: number;
      reason?: string;
    }
  ): Promise<Result<EnqueueOrMergeOutcome, DomainError>> {
    const enqueueResult = await this.outbox.enqueueOrMerge(task, context);
    if (enqueueResult.isErr()) {
      runLogger.warn('computed:outbox:enqueue_failed', {
        error: enqueueResult.error.message,
        planHash: task.planHash,
        ...(details.reason ? { reason: details.reason } : {}),
      });
      return err(enqueueResult.error);
    }

    runLogger.info('computed:run:queued', {
      taskId: enqueueResult.value.taskId,
      pendingSteps: details.pendingSteps,
      asyncStepCount: details.asyncStepCount,
      ...(details.reason ? { reason: details.reason } : {}),
    });
    this.scheduleDispatch(context);
    return enqueueResult;
  }

  /**
   * Lock-miss requeue: persist the original seeds so the worker replans after
   * commit. A frozen computed plan loses insert source fields under one-level
   * clamp (T7018 host lookup/formula stays stale).
   */
  private async enqueueSeedOnLockMiss(
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    runLogger: ILogger,
    details: {
      pendingSteps: number;
      asyncStepCount: number;
      reason: string;
      runId: string;
      orchestration?: IBatchMutationOrchestration;
    }
  ): Promise<Result<{ taskId: string; merged: boolean }, DomainError>> {
    const task = buildSeedTaskInput({
      baseId: plan.baseId,
      seedTableId: plan.seedTableId,
      seedRecordIds: plan.seedRecordIds,
      extraSeedRecords: plan.extraSeedRecords,
      beforeImageRecords: plan.beforeImageRecords,
      changedFieldIds: collectSeedTaskChangedFieldIds(plan),
      changeType: plan.changeType,
      impact: collectSeedTaskImpact(plan),
      cyclePolicy: plan.cyclePolicy,
      hasher: this.hasher,
      runId: details.runId,
      orchestration: details.orchestration,
    });
    const enqueueResult = await this.outbox.enqueueSeedTask(task, context);
    if (enqueueResult.isErr()) {
      runLogger.warn('computed:outbox:enqueue_failed', {
        error: enqueueResult.error.message,
        planHash: task.planHash,
        reason: details.reason,
      });
      return err(enqueueResult.error);
    }

    runLogger.info('computed:run:queued', {
      taskId: enqueueResult.value.taskId,
      pendingSteps: details.pendingSteps,
      asyncStepCount: details.asyncStepCount,
      reason: details.reason,
      taskType: 'seed',
    });
    this.scheduleDispatch(context);
    return enqueueResult;
  }

  async execute(
    updater: ComputedFieldUpdater,
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    options?: UpdateStrategyExecuteOptions
  ): Promise<Result<ComputedUpdateResult | undefined, DomainError>> {
    const rootSpan = context.tracer?.startSpan('teable.computed.hybrid.execute', {
      'computed.baseId': plan.baseId.toString(),
      'computed.seedTableId': plan.seedTableId.toString(),
      'computed.changeType': plan.changeType,
      'computed.dispatchMode': this.config.dispatchMode,
      'computed.syncPolicy': this.config.syncPolicy,
      'computed.planStepCount': plan.steps.length,
      'computed.seedRecordCount': plan.seedRecordIds.length,
    });

    try {
      return await withInlineComputedStatementTimeout(context, this.runtimeConfig, async () => {
        if (rootSpan && context.tracer) {
          return context.tracer.withSpan(rootSpan, () =>
            this.executeInner(updater, plan, context, options, rootSpan)
          );
        }
        return this.executeInner(updater, plan, context, options, rootSpan);
      });
    } finally {
      rootSpan?.end();
    }
  }

  private async executeInner(
    updater: ComputedFieldUpdater,
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    options: UpdateStrategyExecuteOptions | undefined,
    rootSpan: ReturnType<NonNullable<IExecutionContext['tracer']>['startSpan']> | undefined
  ): Promise<Result<ComputedUpdateResult | undefined, DomainError>> {
    // Edge-only plans (delete/orphan propagation: edges but no steps) are real
    // executable work, and seed-all tables are real seed input — neither may be
    // dropped as a no-op here or the propagation never reaches the fixed lower
    // layers.
    if (
      (plan.steps.length === 0 && plan.edges.length === 0) ||
      (plan.seedRecordIds.length === 0 &&
        plan.extraSeedRecords.length === 0 &&
        (plan.seedAllTableIds ?? []).length === 0)
    ) {
      return ok(undefined);
    }

    const admitted = await this.pauseRegistry.admitComputedWrite(
      {
        tableId: plan.seedTableId.toString(),
        baseId: plan.baseId.toString(),
      },
      context
    );
    if (admitted.isErr()) return err(admitted.error);

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
    const sourceFieldIds = collectPlanSourceFieldIds(plan);

    // Accumulate sync changes from all stages
    const allSyncChangesByStep: StepChangeData[] = [];

    while (currentPlan.steps.length > 0 || currentPlan.edges.length > 0) {
      // Whole-table seeding/propagation is expensive before the first UPDATE is
      // even built. Defer before prepareDirtyState so a tiny seed cannot expand
      // an unbounded dirty set inside the user transaction.
      const asyncReason = wholeTableAsyncReason(currentPlan);
      if (asyncReason) {
        const runLogger = this.logger.child(toRunLogContext(baseRun));
        const affectedFieldIds = collectStepFieldIds(currentPlan).map((id) => id.toString());
        const task = buildOutboxTaskInput({
          plan: currentPlan,
          syncMaxLevel: -1,
          hasher: this.hasher,
          runId,
          originRunIds: [...originRunIds],
          runTotalSteps: totalSteps,
          runCompletedStepsBefore: completedSteps,
          ...(affectedFieldIds.length > 0 ? { affectedFieldIds } : {}),
          affectedTableIds: collectStepTableIds(currentPlan).map((id) => id.toString()),
          sourceFieldIds,
          orchestration: options?.orchestration,
        });
        const enqueueResult = await this.enqueuePlan(task, context, runLogger, {
          pendingSteps: currentPlan.steps.length,
          asyncStepCount: currentPlan.steps.length,
          reason: asyncReason,
        });
        if (enqueueResult.isErr()) return err(enqueueResult.error);

        rootSpan?.setAttributes({
          'computed.syncStepCount': 0,
          'computed.asyncStepCount': currentPlan.steps.length,
          'computed.syncMaxLevel': -1,
          'computed.asyncReason': asyncReason,
        });
        return ok({ changesByStep: allSyncChangesByStep });
      }
      // Take seed/write locks before dirty propagation. Propagating first and
      // then missing dirty-target locks discards the temp dirty set with no
      // remaining work in this transaction (T7018).
      const seedTableId = currentPlan.seedTableId.toString();
      const plannedWriteTableIds = [
        ...currentPlan.steps.map((step) => step.tableId.toString()),
        ...currentPlan.extraSeedRecords.map((group) => group.tableId.toString()),
        ...currentPlan.edges.map((edge) => edge.toTableId.toString()),
      ];
      const waitForSmallHostWrite =
        currentPlan.changeType === 'insert' &&
        (currentPlan.seedAllTableIds?.length ?? 0) === 0 &&
        currentPlan.seedRecordIds.length > 0 &&
        currentPlan.seedRecordIds.length <= 16 &&
        plannedWriteTableIds.length > 0 &&
        plannedWriteTableIds.every((tableId) => tableId === seedTableId);
      const lockRun = createComputedUpdateRun({
        runId,
        originRunIds,
        totalSteps,
        completedStepsBefore: completedSteps,
        phase: 'full',
      });
      const lockResult = await updater.acquireLocks(currentPlan, context, {
        logContext: toRunLogContext(lockRun),
        wait: waitForSmallHostWrite,
      });

      const runLogger = this.logger.child(toRunLogContext(lockRun));
      if (lockResult.isErr()) {
        if (!isComputedUpdateLockUnavailable(lockResult.error)) return err(lockResult.error);

        const enqueueResult = await this.enqueueSeedOnLockMiss(currentPlan, context, runLogger, {
          pendingSteps: currentPlan.steps.length,
          asyncStepCount: currentPlan.steps.length,
          reason: 'lock_unavailable',
          runId,
          orchestration: options?.orchestration,
        });
        if (enqueueResult.isErr()) return err(enqueueResult.error);
        return ok({ changesByStep: allSyncChangesByStep });
      }

      const prepared = await updater.prepareDirtyState(currentPlan, context);
      if (prepared.isErr()) return err(prepared.error);

      const { syncSteps, asyncSteps, syncMaxLevel } = splitStepsByPolicy(
        currentPlan,
        prepared.value,
        this.config
      );

      rootSpan?.setAttributes({
        'computed.syncStepCount': syncSteps.length,
        'computed.asyncStepCount': asyncSteps.length,
        'computed.syncMaxLevel': syncMaxLevel,
      });

      const phase = asyncSteps.length === 0 ? 'full' : 'sync';
      const run = createComputedUpdateRun({
        runId,
        originRunIds,
        totalSteps,
        completedStepsBefore: completedSteps,
        phase,
      });

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

      const runSpan =
        syncSteps.length > 0
          ? context.tracer?.startSpan('teable.ComputedUpdateRun', {
              ...toRunSpanAttributes(run),
              'computed.baseId': currentPlan.baseId.toString(),
              'computed.seedTableId': currentPlan.seedTableId.toString(),
              'computed.changeType': currentPlan.changeType,
            })
          : undefined;

      const syncWork = async () =>
        syncSteps.length === 0
          ? ok({ changesByStep: [] })
          : updater.executePreparedSteps(
              currentPlan,
              context,
              prepared.value,
              syncSteps,
              run,
              true,
              {
                wait: false,
                logContext: toRunLogContext(run),
              }
            );
      const syncResult =
        runSpan && context.tracer
          ? await context.tracer.withSpan(runSpan, syncWork)
          : await syncWork();
      runSpan?.end();
      if (syncResult.isErr()) {
        // Dirty-target locks use wait=false; requeue the whole stage on conflict so a later
        // worker recomputes against the latest committed source values.
        if (!isComputedUpdateLockUnavailable(syncResult.error)) return err(syncResult.error);

        const enqueueResult = await this.enqueueSeedOnLockMiss(currentPlan, context, runLogger, {
          pendingSteps: currentPlan.steps.length,
          asyncStepCount: currentPlan.steps.length,
          reason: 'dirty_target_lock_unavailable',
          runId,
          orchestration: options?.orchestration,
        });
        if (enqueueResult.isErr()) return err(enqueueResult.error);
        return ok({ changesByStep: allSyncChangesByStep });
      }

      // Accumulate sync changes from this stage
      pushAll(allSyncChangesByStep, syncResult.value.changesByStep);

      // Publish events for computed updates
      const events = buildComputedUpdateEvents(
        syncResult.value.changesByStep,
        currentPlan.baseId,
        options?.orchestration
      );
      if (events.length > 0) {
        const publish = async () => {
          const publishResult = await this.eventBus.publishMany(
            withoutTransaction(context),
            events
          );
          if (publishResult.isErr()) {
            runLogger.warn('computed:events:publish_failed', {
              error: publishResult.error.message,
              eventCount: events.length,
            });
          } else {
            runLogger.info('computed:events:published', buildComputedUpdateEventLogContext(events));
          }
        };

        if (registerAfterCommit(context, publish)) {
          runLogger.debug('computed:events:publish_deferred', {
            eventCount: events.length,
          });
        } else {
          await publish();
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
          sourceFieldIds,
          orchestration: options?.orchestration,
        });

        const enqueueResult = await this.enqueuePlan(task, context, runLogger, {
          pendingSteps: asyncSteps.length,
          asyncStepCount: asyncSteps.length,
        });
        if (enqueueResult.isErr()) return err(enqueueResult.error);

        runLogger.debug('computed:outbox:enqueued', {
          taskId: enqueueResult.value.taskId,
          merged: enqueueResult.value.merged,
          asyncStepCount: asyncSteps.length,
        });

        // Return sync portion changes even when async steps are queued
        return ok({ changesByStep: allSyncChangesByStep });
      }

      runLogger.info('computed:run:done', {
        completedSteps,
        pendingSteps: 0,
      });

      const nextSeedFieldIds = collectContinuationFieldIds(
        currentPlan,
        syncResult.value.changesByStep
      );
      const tableIds = collectStepTableIds(currentPlan);
      const seedGroupsResult = await updater.collectDirtySeedGroups(context, tableIds);
      if (seedGroupsResult.isErr()) return err(seedGroupsResult.error);

      const { groups: seedGroups, seedAllTableIds } = seedGroupsResult.value;

      const nextPlanResult = await this.planNextStage(
        currentPlan,
        context,
        nextSeedFieldIds,
        seedGroups,
        prepared.value,
        syncResult.value.changesByStep
      );
      if (nextPlanResult.isErr()) return err(nextPlanResult.error);

      // Carry seedAllTableIds through to next plan
      if (seedAllTableIds.length > 0 && nextPlanResult.isOk()) {
        nextPlanResult.value.seedAllTableIds = seedAllTableIds;
      }

      // Filter out already-updated fields from the next plan's steps
      const filteredSteps = nextPlanResult.value.steps
        .map((step) => ({
          ...step,
          fieldIds: step.fieldIds.filter((id) => !updatedFieldIds.has(id.toString())),
        }))
        .filter((step) => step.fieldIds.length > 0);

      if (filteredSteps.length === 0 && nextPlanResult.value.edges.length === 0) break;

      currentPlan = { ...nextPlanResult.value, steps: filteredSteps };
      totalSteps += currentPlan.steps.length;
    }

    return ok({ changesByStep: allSyncChangesByStep });
  }

  scheduleDispatch(context: IExecutionContext): void {
    // 'external' mode: no inline dispatch; BullMQ owns asynchronous delivery.
    if (this.config.dispatchMode === 'external') {
      context.tracer?.getActiveSpan()?.setAttributes({
        'computed.dispatchMode': 'external',
        'computed.dispatchSkipped': true,
        'computed.dispatchSkipReason': 'external_mode',
      });
      this.logger.debug('computed:outbox:dispatch_skipped', {
        reason: 'external_mode',
        message: 'Task enqueued, waiting for an external wake-up',
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

        // Any progress may have enqueued the next cascade stage; keep draining until
        // an empty poll proves the queue is idle (T6191 / dual-link propagation).
        if (result.value <= 0) {
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
    seedGroups: ReadonlyArray<ComputedSeedGroup>,
    prepared: PreparedDirtyState,
    changesByStep: ReadonlyArray<StepChangeData>
  ): Promise<Result<ComputedUpdatePlan, DomainError>> {
    // NOTE: no plan.edges shortcut here — see ComputedUpdateWorker.planNextStage:
    // an edge-less stage's changes may still have cross-record downstream work.

    if (seedFieldIds.length === 0) return ok({ ...plan, steps: [], edges: [] });

    const seedSplit = splitSeedGroupsForPlan(seedGroups, plan.seedTableId);
    if (!seedSplit) return ok({ ...plan, steps: [], edges: [] });

    const beforeImageResult = buildBeforeImageRecordsFromStepChanges({
      seedTableId: seedSplit.seedTableId,
      seedRecordIds: seedSplit.seedRecordIds,
      seedFieldIds,
      changesByStep,
      tableById: prepared.tableById,
    });
    if (beforeImageResult.isErr()) return err(beforeImageResult.error);

    // Carry original mutation before-image (filter fields) into follow-up stages.
    const beforeImageRecords = mergeBeforeImageRecords(
      plan.beforeImageRecords ?? [],
      beforeImageResult.value
    );

    return this.planner.planStage(
      {
        baseId: plan.baseId,
        seedTableId: seedSplit.seedTableId,
        seedRecordIds: seedSplit.seedRecordIds,
        extraSeedRecords: seedSplit.extraSeedRecords,
        beforeImageRecords,
        changedFieldIds: seedFieldIds,
        changeType:
          plan.changeType === 'insert' || plan.changeType === 'delete' ? 'update' : plan.changeType,
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

/** User mutation that started this run. Schema-wide; leftover slices keep it. */
const collectPlanSourceFieldIds = (plan: ComputedUpdatePlan): string[] => {
  if (plan.changedFieldIds?.length) {
    return [...new Set(plan.changedFieldIds.map((fieldId) => fieldId.toString()))];
  }
  const computed = new Set<string>();
  for (const step of plan.steps) {
    for (const fieldId of step.fieldIds) computed.add(fieldId.toString());
  }
  const sources = new Set<string>();
  for (const edge of plan.edges) {
    const from = edge.fromFieldId.toString();
    if (!computed.has(from)) sources.add(from);
  }
  return [...sources];
};

const collectSeedTaskChangedFieldIds = (plan: ComputedUpdatePlan): FieldId[] => {
  const seen = new Set<string>();
  const ids: FieldId[] = [];
  const add = (fieldId: FieldId) => {
    const key = fieldId.toString();
    if (seen.has(key)) return;
    seen.add(key);
    ids.push(fieldId);
  };
  if (plan.changedFieldIds) {
    for (const fieldId of plan.changedFieldIds) add(fieldId);
  }
  for (const fieldId of collectStepFieldIds(plan)) add(fieldId);
  for (const edge of plan.edges) add(edge.fromFieldId);
  return ids;
};

const collectSeedTaskImpact = (
  plan: ComputedUpdatePlan
): { valueFieldIds: FieldId[]; linkFieldIds: FieldId[] } => {
  const valueFieldIds = collectSeedTaskChangedFieldIds(plan);
  const seen = new Set<string>();
  const linkFieldIds: FieldId[] = [];
  for (const edge of plan.edges) {
    if (!edge.linkFieldId) continue;
    const key = edge.linkFieldId.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    linkFieldIds.push(edge.linkFieldId);
  }
  return { valueFieldIds, linkFieldIds };
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

  const syncStepKey = (step: UpdateStep): string => `${step.tableId.toString()}|${step.level}`;

  if (config.syncPolicy === 'none') {
    return { syncSteps: [], asyncSteps: plan.steps, syncMaxLevel: -1 };
  }

  if (config.syncPolicy === 'seedTableOnly') {
    const seedSteps = plan.steps.filter((step) => step.tableId.toString() === seedTableId);
    const dirtyCountByTable = new Map(
      prepared.dirtyStats.map((stat) => [stat.tableId, stat.recordCount])
    );
    const seedLevels = [...new Set(seedSteps.map((step) => step.level))].sort((a, b) => a - b);

    let syncMaxLevel = -1;
    let cumulativeDirty = 0;

    for (const level of seedLevels) {
      const levelSteps = seedSteps.filter((step) => step.level === level);
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

    const syncSteps = seedSteps.filter((step) => step.level <= syncMaxLevel);
    const syncStepKeys = new Set(syncSteps.map(syncStepKey));
    const asyncSteps = plan.steps.filter((step) => !syncStepKeys.has(syncStepKey(step)));
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
  baseId: BaseId,
  orchestration?: IBatchMutationOrchestration
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
        oldValue: fieldChange.oldValue,
        newValue: fieldChange.newValue,
      })),
    }));

    events.push(
      RecordsBatchUpdated.create({
        tableId: tableIdResult.value,
        baseId,
        updates,
        source: 'computed',
        orchestration,
      })
    );
  }

  return events;
};

const buildComputedUpdateEventLogContext = (events: ReadonlyArray<RecordsBatchUpdated>) => ({
  eventCount: events.length,
  tableIds: [...new Set(events.map((event) => event.tableId.toString()))],
  events: events.slice(0, maxComputedEventLogItems).map((event) => {
    const fieldIds = [
      ...new Set(event.updates.flatMap((update) => update.changes.map((change) => change.fieldId))),
    ];
    const recordIds = event.updates.map((update) => update.recordId);
    return {
      tableId: event.tableId.toString(),
      recordCount: event.updates.length,
      recordIds: recordIds.slice(0, maxComputedEventLogRecordIds),
      hasMoreRecordIds: recordIds.length > maxComputedEventLogRecordIds,
      fieldIds: fieldIds.slice(0, maxComputedEventLogFieldIds),
      hasMoreFieldIds: fieldIds.length > maxComputedEventLogFieldIds,
    };
  }),
  hasMoreEvents: events.length > maxComputedEventLogItems,
});
