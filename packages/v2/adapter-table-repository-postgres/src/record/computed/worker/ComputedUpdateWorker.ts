import {
  ActorId,
  domainError,
  FieldId,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  RecordsBatchUpdated,
} from '@teable/v2-core';
import type {
  BaseId,
  DomainError,
  IExecutionContext,
  IHasher,
  ITableRepository,
  IUnitOfWork,
  ILogger,
  IEventBus,
  ITracer,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { ComputedFieldBackfillService } from '../ComputedFieldBackfillService';
import type { ComputedFieldUpdater, StepChangeData } from '../ComputedFieldUpdater';
import type {
  ComputedSeedGroup,
  ComputedUpdatePlan,
  ComputedUpdatePlanner,
} from '../ComputedUpdatePlanner';
import { splitSeedGroupsForPlan } from '../ComputedUpdatePlanner';
import { createComputedUpdateRun } from '../ComputedUpdateRun';
import type {
  ComputedUpdateOutboxItem,
  ComputedUpdateOutboxPayload,
} from '../outbox/ComputedUpdateOutboxPayload';
import {
  buildOutboxTaskInput,
  deserializeComputedUpdatePlan,
} from '../outbox/ComputedUpdateOutboxPayload';
import { deserializeSeedPayload } from '../outbox/ComputedUpdateSeedPayload';
import { toErrorLogFields } from '../errorLog';
import type {
  AnyOutboxItem,
  ComputedUpdateOutboxConfig,
  FieldBackfillOutboxItem,
  SeedOutboxItem,
  IComputedUpdateOutbox,
} from '../outbox/IComputedUpdateOutbox';
import { isFieldBackfillOutboxItem, isSeedOutboxItem } from '../outbox/IComputedUpdateOutbox';

/**
 * Maximum stage depth to prevent cascading update loops.
 * Each time a computed update creates a follow-up task, the stage depth increments.
 * When this limit is reached, no more follow-up tasks are created.
 */
const MAX_STAGE_DEPTH = 50;

export type ComputedUpdateWorkerParams = {
  workerId: string;
  limit: number;
  actorId?: ActorId;
  tracer?: ITracer;
  /** Request ID for ShareDB src matching (propagated from original request) */
  requestId?: string;
};

export type ComputedUpdateWorkerRunTaskByIdParams = {
  taskId: string;
  workerId: string;
  actorId?: ActorId;
  tracer?: ITracer;
  requestId?: string;
  allowProcessingTakeover?: boolean;
};

class ClaimedTaskLeaseManager {
  private readonly taskOwners = new Map<string, string>();
  private readonly lostTaskIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private heartbeatPromise: Promise<void> | null = null;

  constructor(
    tasks: ReadonlyArray<AnyOutboxItem>,
    private readonly outbox: IComputedUpdateOutbox,
    private readonly logger: ILogger,
    private readonly heartbeatIntervalMs: number
  ) {
    for (const task of tasks) {
      if (task.lockedBy) {
        this.taskOwners.set(task.id, task.lockedBy);
      }
    }
  }

  start(): void {
    if (this.taskOwners.size === 0 || this.heartbeatIntervalMs <= 0 || this.timer) return;
    this.timer = setInterval(() => {
      void this.heartbeat();
    }, this.heartbeatIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.heartbeatPromise) {
      await this.heartbeatPromise;
    }
  }

  releaseTask(taskId: string): void {
    this.taskOwners.delete(taskId);
    this.lostTaskIds.delete(taskId);
    if (this.taskOwners.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async ensureTaskActive(taskId: string): Promise<boolean> {
    if (this.lostTaskIds.has(taskId)) return false;
    const leaseOwner = this.taskOwners.get(taskId);
    if (!leaseOwner) return true;

    await this.heartbeat([taskId]);
    return !this.lostTaskIds.has(taskId);
  }

  private async heartbeat(taskIds?: string[]): Promise<void> {
    if (this.taskOwners.size === 0) return;
    if (this.heartbeatPromise) {
      await this.heartbeatPromise;
      if (!taskIds) return;
    }

    this.heartbeatPromise = this.runHeartbeat(taskIds).finally(() => {
      this.heartbeatPromise = null;
    });
    await this.heartbeatPromise;
  }

  private async runHeartbeat(taskIds?: string[]): Promise<void> {
    const groupedTaskIds = this.groupTaskIds(taskIds);
    if (groupedTaskIds.size === 0) return;

    for (const [leaseOwner, ids] of groupedTaskIds) {
      const renewResult = await this.outbox.renewLease({
        taskIds: ids,
        leaseOwner,
      });

      if (renewResult.isErr()) {
        this.logger.warn('computed:worker:lease_renew_failed', {
          leaseOwner,
          taskIds: ids,
          error: renewResult.error.message,
        });
        continue;
      }

      const renewedIds = new Set(renewResult.value);
      const lostIds = ids.filter((id) => !renewedIds.has(id));
      if (lostIds.length === 0) continue;

      for (const lostId of lostIds) {
        this.taskOwners.delete(lostId);
        this.lostTaskIds.add(lostId);
      }

      this.logger.warn('computed:worker:lease_lost', {
        leaseOwner,
        taskIds: lostIds,
      });
    }
  }

  private groupTaskIds(taskIds?: string[]): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    const ids = taskIds ?? [...this.taskOwners.keys()];

    for (const taskId of ids) {
      const leaseOwner = this.taskOwners.get(taskId);
      if (!leaseOwner) continue;
      const group = grouped.get(leaseOwner) ?? [];
      group.push(taskId);
      grouped.set(leaseOwner, group);
    }

    return grouped;
  }
}

/**
 * Background worker that processes computed update outbox tasks.
 *
 * Example
 * ```typescript
 * const processed = await worker.runOnce({ workerId: 'worker-1', limit: 10 });
 * ```
 */
@injectable()
export class ComputedUpdateWorker {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateOutbox)
    private readonly outbox: IComputedUpdateOutbox,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig)
    private readonly outboxConfig: ComputedUpdateOutboxConfig,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldUpdater)
    private readonly updater: ComputedFieldUpdater,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly planner: ComputedUpdatePlanner,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: IUnitOfWork,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2CoreTokens.hasher)
    private readonly hasher: IHasher,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldBackfillService)
    private readonly backfillService: ComputedFieldBackfillService,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: IEventBus
  ) {}

  async runOnce(params: ComputedUpdateWorkerParams): Promise<Result<number, DomainError>> {
    const span = params.tracer?.startSpan('teable.worker.runOnce', {
      'worker.id': params.workerId,
      'worker.limit': params.limit,
    });

    const executeRunOnce = async (): Promise<Result<number, DomainError>> => {
      return safeTry<number, DomainError>(
        async function* (this: ComputedUpdateWorker) {
          const actorIdResult = params.actorId ? ok(params.actorId) : ActorId.create('system');
          if (actorIdResult.isErr()) return err(actorIdResult.error);

          const baseContext: IExecutionContext = {
            actorId: actorIdResult.value,
            tracer: params.tracer,
            requestId: params.requestId,
          };

          const claimed = yield* await this.outbox.claimBatch(
            {
              workerId: params.workerId,
              limit: params.limit,
            },
            baseContext
          );

          if (claimed.length === 0) return ok(0);

          this.logger.debug('computed:worker:runOnce:start', {
            claimedTasks: claimed.length,
            taskTypes: claimed.map((t) =>
              isFieldBackfillOutboxItem(t) ? 'backfill' : isSeedOutboxItem(t) ? 'seed' : 'computed'
            ),
          });

          const leaseManager = this.createLeaseManager(claimed);
          leaseManager.start();

          let processed = 0;
          try {
            for (const task of claimed) {
              if (!(await leaseManager.ensureTaskActive(task.id))) {
                this.logger.warn('computed:worker:task_skipped_lost_lease', {
                  taskId: task.id,
                  leaseOwner: task.lockedBy ?? null,
                });
                leaseManager.releaseTask(task.id);
                continue;
              }

              try {
                const processResult = await this.processClaimedTask(
                  task,
                  actorIdResult.value,
                  params.tracer,
                  params.requestId
                );
                if (processResult.isOk() && processResult.value) {
                  processed += 1;
                }
              } finally {
                leaseManager.releaseTask(task.id);
              }
            }
          } finally {
            await leaseManager.stop();
          }

          return ok(processed);
        }.bind(this)
      );
    };

    try {
      if (span && params.tracer) {
        return await params.tracer.withSpan(span, executeRunOnce);
      }
      return await executeRunOnce();
    } finally {
      span?.end();
    }
  }

  async runTaskById(
    params: ComputedUpdateWorkerRunTaskByIdParams
  ): Promise<Result<boolean, DomainError>> {
    const span = params.tracer?.startSpan('teable.worker.runTaskById', {
      'worker.id': params.workerId,
      'outbox.taskId': params.taskId,
    });

    const executeRunTaskById = async (): Promise<Result<boolean, DomainError>> => {
      return safeTry<boolean, DomainError>(
        async function* (this: ComputedUpdateWorker) {
          const actorIdResult = params.actorId ? ok(params.actorId) : ActorId.create('system');
          if (actorIdResult.isErr()) return err(actorIdResult.error);

          const context: IExecutionContext = {
            actorId: actorIdResult.value,
            tracer: params.tracer,
            requestId: params.requestId,
          };

          const claimed = yield* await this.outbox.claimById(
            {
              taskId: params.taskId,
              workerId: params.workerId,
              allowProcessingTakeover: params.allowProcessingTakeover ?? true,
            },
            context
          );

          if (!claimed) return ok(false);

          const leaseManager = this.createLeaseManager([claimed]);
          leaseManager.start();
          try {
            if (!(await leaseManager.ensureTaskActive(claimed.id))) {
              return ok(false);
            }

            const processResult = await this.processClaimedTask(
              claimed,
              actorIdResult.value,
              params.tracer,
              params.requestId
            );
            if (processResult.isErr()) return err(processResult.error);
            return ok(processResult.value);
          } finally {
            leaseManager.releaseTask(claimed.id);
            await leaseManager.stop();
          }
        }.bind(this)
      );
    };

    try {
      if (span && params.tracer) {
        return await params.tracer.withSpan(span, executeRunTaskById);
      }
      return await executeRunTaskById();
    } finally {
      span?.end();
    }
  }

  private createLeaseManager(tasks: ReadonlyArray<AnyOutboxItem>): ClaimedTaskLeaseManager {
    return new ClaimedTaskLeaseManager(
      tasks,
      this.outbox,
      this.logger,
      this.outboxConfig.heartbeatIntervalMs
    );
  }

  private async processClaimedTask(
    task: AnyOutboxItem,
    actorId: ActorId,
    tracer?: ITracer,
    requestId?: string
  ): Promise<Result<boolean, DomainError>> {
    if (isFieldBackfillOutboxItem(task)) {
      return this.processFieldBackfillTask(task, actorId, tracer, requestId);
    }

    if (isSeedOutboxItem(task)) {
      return this.processSeedTask(task, actorId, tracer, requestId);
    }

    return this.processComputedTask(task as ComputedUpdateOutboxItem, actorId, tracer, requestId);
  }

  private async processComputedTask(
    computedTask: ComputedUpdateOutboxItem,
    actorId: ActorId,
    tracer?: ITracer,
    requestId?: string
  ): Promise<Result<boolean, DomainError>> {
    const context: IExecutionContext = { actorId, tracer, requestId };
    const runLogContext = {
      computedRunId: computedTask.runId,
      computedOriginRunIds: computedTask.originRunIds,
      computedTaskId: computedTask.id,
    };
    let failurePhase:
      | 'deserialize_plan'
      | 'collect_seed_field_ids'
      | 'collect_seed_table_ids'
      | 'acquire_locks'
      | 'execute_plan'
      | 'publish_events'
      | 'collect_dirty_seed_groups'
      | 'plan_next_stage'
      | 'enqueue_next_stage'
      | 'mark_done' = 'deserialize_plan';
    const logTaskFailure = (error: unknown) => {
      this.logger.error('computed:outbox:task_failed', {
        taskId: computedTask.id,
        phase: failurePhase,
        stageDepth: computedTask.stageDepth ?? 0,
        stepCount: computedTask.steps.length,
        edgeCount: computedTask.edges.length,
        seedRecordCount: computedTask.seedRecordIds.length,
        extraSeedGroupCount: computedTask.extraSeedRecords.length,
        affectedFieldCount: computedTask.affectedFieldIds.length,
        ...toErrorLogFields(error),
        ...runLogContext,
      });
    };
    const payload = toPayload(computedTask);
    const planResult = deserializeComputedUpdatePlan(payload);
    if (planResult.isErr()) {
      logTaskFailure(planResult.error);
      await this.handleTaskFailure(computedTask, planResult.error.message, context);
      return err(planResult.error);
    }

    const totalSteps =
      computedTask.runTotalSteps > 0
        ? computedTask.runTotalSteps
        : computedTask.runCompletedStepsBefore + computedTask.steps.length;
    const runId = computedTask.runId?.length ? computedTask.runId : undefined;
    const originRunIds = computedTask.originRunIds?.length ? computedTask.originRunIds : undefined;

    failurePhase = 'collect_seed_field_ids';
    const stageFieldIdsResult = collectSeedFieldIds(computedTask);
    if (stageFieldIdsResult.isErr()) {
      logTaskFailure(stageFieldIdsResult.error);
      await this.handleTaskFailure(computedTask, stageFieldIdsResult.error.message, context);
      return err(stageFieldIdsResult.error);
    }

    failurePhase = 'collect_seed_table_ids';
    const stageTableIdsResult = collectSeedTableIds(computedTask);
    if (stageTableIdsResult.isErr()) {
      logTaskFailure(stageTableIdsResult.error);
      await this.handleTaskFailure(computedTask, stageTableIdsResult.error.message, context);
      return err(stageTableIdsResult.error);
    }

    const executeResult = await this.unitOfWork.withTransaction(context, async (txContext) => {
      const run = createComputedUpdateRun({
        runId,
        originRunIds,
        totalSteps,
        completedStepsBefore: computedTask.runCompletedStepsBefore,
        phase: 'async',
        taskId: computedTask.id,
      });

      failurePhase = 'acquire_locks';
      const lockResult = await this.updater.acquireLocks(planResult.value, txContext, {
        logContext: runLogContext,
      });
      if (lockResult.isErr()) return err(lockResult.error);

      failurePhase = 'execute_plan';
      const stageResult = await this.updater.execute(planResult.value, txContext, run, {
        collectChanges: true,
      });
      if (stageResult.isErr()) return err(stageResult.error);

      const events = buildComputedUpdateEvents(
        stageResult.value.changesByStep,
        planResult.value.baseId
      );
      if (events.length > 0) {
        failurePhase = 'publish_events';
        const publishResult = await this.eventBus.publishMany(txContext, events);
        if (publishResult.isErr()) {
          this.logger.warn('computed:worker:events_publish_failed', {
            error: publishResult.error.message,
            eventCount: events.length,
            ...runLogContext,
          });
        } else {
          this.logger.debug('computed:worker:events_published', {
            eventCount: events.length,
            tableIds: [...new Set(events.map((e) => e.tableId.toString()))],
            ...runLogContext,
          });
        }
      }

      const completedStepsAfter = computedTask.runCompletedStepsBefore + computedTask.steps.length;
      failurePhase = 'collect_dirty_seed_groups';
      const seedGroupsResult = await this.updater.collectDirtySeedGroups(
        txContext,
        stageTableIdsResult.value
      );
      if (seedGroupsResult.isErr()) return err(seedGroupsResult.error);

      failurePhase = 'plan_next_stage';
      const nextPlanResult = await this.planNextStage(
        planResult.value,
        txContext,
        stageFieldIdsResult.value,
        seedGroupsResult.value
      );
      if (nextPlanResult.isErr()) return err(nextPlanResult.error);

      const currentStageDepth = computedTask.stageDepth ?? 0;

      if (nextPlanResult.value.steps.length > 0) {
        if (currentStageDepth >= MAX_STAGE_DEPTH) {
          this.logger.warn('computed:worker:max_stage_depth_reached', {
            taskId: computedTask.id,
            stageDepth: currentStageDepth,
            skippedSteps: nextPlanResult.value.steps.length,
            ...runLogContext,
          });
        } else {
          const nextTotalSteps =
            Math.max(totalSteps, completedStepsAfter) + nextPlanResult.value.steps.length;
          const nextTask = buildOutboxTaskInput({
            plan: nextPlanResult.value,
            dirtyStats: seedGroupsResult.value.map((group) => ({
              tableId: group.tableId.toString(),
              recordCount: group.recordIds.length,
            })),
            syncMaxLevel: 0,
            hasher: this.hasher,
            runId: run.runId,
            originRunIds: [...run.originRunIds],
            runTotalSteps: nextTotalSteps,
            runCompletedStepsBefore: completedStepsAfter,
            stageDepth: currentStageDepth + 1,
          });

          failurePhase = 'enqueue_next_stage';
          const enqueueResult = await this.outbox.enqueueOrMerge(nextTask, txContext);
          if (enqueueResult.isErr()) return err(enqueueResult.error);
        }
      }

      failurePhase = 'mark_done';
      const doneResult = await this.outbox.markDone(computedTask, txContext);
      if (doneResult.isErr()) return err(doneResult.error);
      if (!doneResult.value) return ok(false);

      return ok(true);
    });
    if (executeResult.isErr()) {
      logTaskFailure(executeResult.error);
      await this.handleTaskFailure(computedTask, executeResult.error.message, context);
      return err(executeResult.error);
    }

    return ok(executeResult.value);
  }

  private async handleTaskFailure(
    task: AnyOutboxItem,
    message: string,
    context?: IExecutionContext
  ): Promise<boolean> {
    const result = await this.outbox.markFailed(task, message, context);
    if (result.isErr()) {
      this.logger.warn('computed:outbox:markFailed_failed', {
        taskId: task.id,
        error: result.error.message,
      });
      return false;
    }

    if (!result.value) {
      this.logger.warn('computed:outbox:markFailed_skipped', {
        taskId: task.id,
        leaseOwner: task.lockedBy ?? null,
      });
    }

    return result.value;
  }

  /**
   * Process a field backfill task.
   * Loads the table, resolves field IDs, and executes the backfill.
   */
  private async processFieldBackfillTask(
    task: FieldBackfillOutboxItem,
    actorId: ActorId,
    tracer?: ITracer,
    requestId?: string
  ): Promise<Result<boolean, DomainError>> {
    const context: IExecutionContext = { actorId, tracer, requestId };
    const runLogContext = {
      computedRunId: task.runId,
      computedTaskId: task.id,
      taskType: 'field-backfill',
    };

    this.logger.debug('computed:worker:field_backfill_start', {
      taskId: task.id,
      tableId: task.tableId,
      fieldIds: task.fieldIds,
      ...runLogContext,
    });

    // Parse field IDs
    const fieldIdsResult = task.fieldIds.reduce<Result<FieldId[], DomainError>>(
      (acc, fieldId) =>
        acc.andThen((ids) =>
          FieldId.create(fieldId).map((id) => {
            ids.push(id);
            return ids;
          })
        ),
      ok([])
    );
    if (fieldIdsResult.isErr()) {
      this.logger.error('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: fieldIdsResult.error.message,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, fieldIdsResult.error.message, context);
      return err(fieldIdsResult.error);
    }

    // Parse table ID
    const tableIdResult = TableId.create(task.tableId);
    if (tableIdResult.isErr()) {
      this.logger.error('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: tableIdResult.error.message,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, tableIdResult.error.message, context);
      return err(tableIdResult.error);
    }

    // Load table with fields
    const tableSpec = TableByIdSpec.create(tableIdResult.value);
    const tableResult = await this.tableRepository.findOne(context, tableSpec);
    if (tableResult.isErr()) {
      this.logger.error('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: tableResult.error.message,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, tableResult.error.message, context);
      return err(tableResult.error);
    }

    const table = tableResult.value;
    if (!table) {
      const message = `Table not found: ${task.tableId}`;
      this.logger.error('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: message,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, message, context);
      return err(domainError.notFound({ code: 'table.not_found', message }));
    }

    // Get fields to backfill
    const fieldsToBackfill: ReturnType<typeof table.getFields> = [];
    for (const fieldId of fieldIdsResult.value) {
      const fieldResult = table.getField((f) => f.id().equals(fieldId));
      if (fieldResult.isOk()) {
        (fieldsToBackfill as Array<typeof fieldResult.value>).push(fieldResult.value);
      }
    }

    if (fieldsToBackfill.length === 0) {
      const message = `No fields found for backfill: ${task.fieldIds.join(', ')}`;
      this.logger.warn('computed:worker:field_backfill_no_fields', {
        taskId: task.id,
        ...runLogContext,
      });
      // Mark as done since there's nothing to backfill
      const doneResult = await this.outbox.markDone(task, context);
      return doneResult;
    }

    // Execute backfill within a transaction
    const executeResult: Result<boolean, DomainError> = await this.unitOfWork.withTransaction(
      context,
      async (txContext) => {
        // Execute sync backfill for all fields
        const backfillResult = await this.backfillService.executeSyncMany(txContext, {
          table,
          fields: fieldsToBackfill,
        });
        if (backfillResult.isErr()) return err(backfillResult.error);

        // Mark task as done
        const doneResult = await this.outbox.markDone(task, txContext);
        if (doneResult.isErr()) return doneResult;
        if (!doneResult.value) return ok(false);

        return ok(true);
      }
    );

    if (executeResult.isErr()) {
      this.logger.error('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: executeResult.error.message,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, executeResult.error.message, context);
      return err(executeResult.error);
    }

    this.logger.debug('computed:worker:field_backfill_done', {
      taskId: task.id,
      tableId: task.tableId,
      fieldCount: fieldsToBackfill.length,
      ...runLogContext,
    });

    return ok(true);
  }

  /**
   * Process a seed task.
   * Seed tasks contain minimal trigger information - we compute the full plan here
   * and then execute it.
   */
  private async processSeedTask(
    task: SeedOutboxItem,
    actorId: ActorId,
    tracer?: ITracer,
    requestId?: string
  ): Promise<Result<boolean, DomainError>> {
    const context: IExecutionContext = { actorId, tracer, requestId };
    const runLogContext = {
      computedRunId: task.runId,
      computedTaskId: task.id,
      taskType: 'seed',
    };
    let failurePhase:
      | 'deserialize_seed_payload'
      | 'load_seed_table'
      | 'plan_seed'
      | 'acquire_locks'
      | 'execute_plan'
      | 'publish_events'
      | 'collect_dirty_seed_groups'
      | 'plan_next_stage'
      | 'enqueue_next_stage'
      | 'mark_done' = 'deserialize_seed_payload';
    const logSeedFailure = (
      error: unknown,
      logType:
        | 'computed:worker:seed_failed'
        | 'computed:worker:seed_plan_failed' = 'computed:worker:seed_failed'
    ) => {
      this.logger.error(logType, {
        taskId: task.id,
        phase: failurePhase,
        seedTableId: task.seedTableId,
        seedRecordCount: task.seedRecordIds.length,
        changedFieldCount: task.changedFieldIds.length,
        ...toErrorLogFields(error),
        ...runLogContext,
      });
    };

    this.logger.debug('computed:worker:seed_start', {
      taskId: task.id,
      seedTableId: task.seedTableId,
      seedRecordCount: task.seedRecordIds.length,
      changedFieldIds: task.changedFieldIds,
      ...runLogContext,
    });

    // Deserialize seed payload to domain objects
    const seedPayloadResult = deserializeSeedPayload(task);
    if (seedPayloadResult.isErr()) {
      logSeedFailure(seedPayloadResult.error);
      await this.handleTaskFailure(task, seedPayloadResult.error.message, context);
      return err(seedPayloadResult.error);
    }

    const seedData = seedPayloadResult.value;

    // Load table with fields
    failurePhase = 'load_seed_table';
    const tableSpec = TableByIdSpec.create(seedData.seedTableId);
    const tableResult = await this.tableRepository.findOne(context, tableSpec);
    if (tableResult.isErr()) {
      logSeedFailure(tableResult.error);
      await this.handleTaskFailure(task, tableResult.error.message, context);
      return err(tableResult.error);
    }

    const table = tableResult.value;
    if (!table) {
      const message = `Table not found: ${task.seedTableId}`;
      logSeedFailure(message);
      await this.handleTaskFailure(task, message, context);
      return err(domainError.notFound({ code: 'table.not_found', message }));
    }

    // Compute the full plan from seed data
    failurePhase = 'plan_seed';
    const planResult = await this.planner.plan(
      {
        table,
        changedFieldIds: seedData.changedFieldIds,
        changedRecordIds: seedData.seedRecordIds,
        changeType: seedData.changeType,
        cyclePolicy: seedData.cyclePolicy,
        impact: seedData.impact
          ? {
              valueFieldIds: seedData.impact.valueFieldIds,
              linkFieldIds: seedData.impact.linkFieldIds,
            }
          : undefined,
      },
      context
    );
    if (planResult.isErr()) {
      logSeedFailure(planResult.error, 'computed:worker:seed_plan_failed');
      await this.handleTaskFailure(task, planResult.error.message, context);
      return err(planResult.error);
    }

    const plan: ComputedUpdatePlan = {
      ...planResult.value,
      extraSeedRecords: seedData.extraSeedRecords,
      beforeImageRecords: seedData.beforeImageRecords,
    };

    // If no steps, nothing to do
    if (plan.steps.length === 0) {
      this.logger.debug('computed:worker:seed_no_steps', {
        taskId: task.id,
        ...runLogContext,
      });
      const doneResult = await this.outbox.markDone(task, context);
      return doneResult;
    }

    // Execute the plan within a transaction
    const executeResult = await this.unitOfWork.withTransaction(context, async (txContext) => {
      const run = createComputedUpdateRun({
        runId: task.runId,
        totalSteps: plan.steps.length,
        completedStepsBefore: 0,
        phase: 'async',
        taskId: task.id,
      });

      failurePhase = 'acquire_locks';
      const lockResult = await this.updater.acquireLocks(plan, txContext, {
        logContext: runLogContext,
      });
      if (lockResult.isErr()) return err(lockResult.error);

      failurePhase = 'execute_plan';
      const stageResult = await this.updater.execute(plan, txContext, run, {
        collectChanges: true,
      });
      if (stageResult.isErr()) return err(stageResult.error);

      // Publish events for computed updates
      const events = buildComputedUpdateEvents(stageResult.value.changesByStep, plan.baseId);
      if (events.length > 0) {
        failurePhase = 'publish_events';
        const publishResult = await this.eventBus.publishMany(txContext, events);
        if (publishResult.isErr()) {
          this.logger.warn('computed:worker:seed_events_publish_failed', {
            error: publishResult.error.message,
            eventCount: events.length,
            ...runLogContext,
          });
        } else {
          this.logger.debug('computed:worker:seed_events_published', {
            eventCount: events.length,
            tableIds: [...new Set(events.map((e) => e.tableId.toString()))],
            ...runLogContext,
          });
        }
      }

      // Collect seed groups for next stage
      const stageTableIds = plan.steps.map((step) => step.tableId);
      failurePhase = 'collect_dirty_seed_groups';
      const seedGroupsResult = await this.updater.collectDirtySeedGroups(txContext, stageTableIds);
      if (seedGroupsResult.isErr()) return err(seedGroupsResult.error);

      // Plan next stage if needed
      // If there are no cross-record propagation edges, the plan is purely same-record
      // (e.g. same-table formula chains) and should not enqueue follow-up stages.
      if (plan.edges.length === 0) {
        const doneResult = await this.outbox.markDone(task, txContext);
        if (doneResult.isErr()) return err(doneResult.error);
        if (!doneResult.value) return ok(false);
        return ok(true);
      }
      const stageFieldIds = plan.steps.flatMap((step) => step.fieldIds);
      failurePhase = 'plan_next_stage';
      const nextPlanResult = await this.planNextStage(
        plan,
        txContext,
        stageFieldIds,
        seedGroupsResult.value
      );
      if (nextPlanResult.isErr()) return err(nextPlanResult.error);

      // Enqueue next stage if there are more steps
      // Seed tasks start at depth 0, so the first follow-up is depth 1
      if (nextPlanResult.value.steps.length > 0) {
        const nextTask = buildOutboxTaskInput({
          plan: nextPlanResult.value,
          dirtyStats: seedGroupsResult.value.map((group) => ({
            tableId: group.tableId.toString(),
            recordCount: group.recordIds.length,
          })),
          syncMaxLevel: 0,
          hasher: this.hasher,
          runId: run.runId,
          originRunIds: [...run.originRunIds],
          runTotalSteps: plan.steps.length + nextPlanResult.value.steps.length,
          runCompletedStepsBefore: plan.steps.length,
          stageDepth: 1,
        });

        failurePhase = 'enqueue_next_stage';
        const enqueueResult = await this.outbox.enqueueOrMerge(nextTask, txContext);
        if (enqueueResult.isErr()) return err(enqueueResult.error);
      }

      // Mark seed task as done
      failurePhase = 'mark_done';
      const doneResult = await this.outbox.markDone(task, txContext);
      if (doneResult.isErr()) return err(doneResult.error);
      if (!doneResult.value) return ok(false);

      return ok(true);
    });

    if (executeResult.isErr()) {
      logSeedFailure(executeResult.error);
      await this.handleTaskFailure(task, executeResult.error.message, context);
      return err(executeResult.error);
    }

    this.logger.debug('computed:worker:seed_done', {
      taskId: task.id,
      seedTableId: task.seedTableId,
      stepCount: plan.steps.length,
      ...runLogContext,
    });

    return ok(executeResult.value);
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

    const startTime = Date.now();
    const result = await this.planner.planStage(
      {
        baseId: plan.baseId,
        seedTableId: seedSplit.seedTableId,
        seedRecordIds: seedSplit.seedRecordIds,
        extraSeedRecords: seedSplit.extraSeedRecords,
        beforeImageRecords: [],
        changedFieldIds: seedFieldIds,
        // After the initial insert/delete is processed, subsequent stages should behave like
        // updates. Follow-up stages are recomputing surviving records based on computed-field
        // changes, not replaying the original row deletion/insertion semantics.
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

    const elapsedMs = Date.now() - startTime;
    if (result.isOk() && (elapsedMs > 100 || result.value.steps.length > 0)) {
      this.logger.debug('computed:worker:planNextStage', {
        elapsedMs,
        inputSeedFieldIds: seedFieldIds.length,
        inputSeedGroups: seedGroups.length,
        inputSeedRecords: seedGroups.reduce((acc, g) => acc + g.recordIds.length, 0),
        outputSteps: result.value.steps.length,
        outputEdges: result.value.edges.length,
        seedTableId: seedSplit.seedTableId.toString(),
      });
    }

    return result;
  }
}

const toPayload = (task: ComputedUpdateOutboxItem): ComputedUpdateOutboxPayload => ({
  baseId: task.baseId,
  seedTableId: task.seedTableId,
  seedRecordIds: task.seedRecordIds,
  extraSeedRecords: task.extraSeedRecords,
  beforeImageRecords: task.beforeImageRecords,
  steps: task.steps,
  edges: task.edges,
  estimatedComplexity: task.estimatedComplexity,
  changeType: task.changeType,
});

const collectSeedFieldIds = (
  task: ComputedUpdateOutboxItem
): Result<ReadonlyArray<FieldId>, DomainError> => {
  const ids = new Map<string, FieldId>();
  const candidates = task.affectedFieldIds.length ? task.affectedFieldIds : [];

  for (const fieldId of candidates) {
    const parsed = FieldId.create(fieldId);
    if (parsed.isErr()) return err(parsed.error);
    ids.set(parsed.value.toString(), parsed.value);
  }

  if (ids.size > 0) return ok([...ids.values()]);

  for (const step of task.steps) {
    for (const fieldId of step.fieldIds) {
      const parsed = FieldId.create(fieldId);
      if (parsed.isErr()) return err(parsed.error);
      ids.set(parsed.value.toString(), parsed.value);
    }
  }

  return ok([...ids.values()]);
};

const collectSeedTableIds = (
  task: ComputedUpdateOutboxItem
): Result<ReadonlyArray<TableId>, DomainError> => {
  const ids = new Map<string, TableId>();
  const candidates = task.affectedTableIds.length ? task.affectedTableIds : [];

  for (const tableId of candidates) {
    const parsed = TableId.create(tableId);
    if (parsed.isErr()) return err(parsed.error);
    ids.set(parsed.value.toString(), parsed.value);
  }

  if (ids.size > 0) return ok([...ids.values()]);

  for (const step of task.steps) {
    const parsed = TableId.create(step.tableId);
    if (parsed.isErr()) return err(parsed.error);
    ids.set(parsed.value.toString(), parsed.value);
  }

  return ok([...ids.values()]);
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

    const tableIdResult = TableId.create(tableIdStr);
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
