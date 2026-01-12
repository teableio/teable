import {
  ActorId,
  domainError,
  type DomainError,
  FieldId,
  type IComputedFieldBackfillService,
  type IExecutionContext,
  type IHasher,
  type ITableRepository,
  type IUnitOfWork,
  type ILogger,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { ComputedFieldUpdater } from '../ComputedFieldUpdater';
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
import type {
  AnyOutboxItem,
  FieldBackfillOutboxItem,
  IComputedUpdateOutbox,
} from '../outbox/IComputedUpdateOutbox';
import { isFieldBackfillOutboxItem } from '../outbox/IComputedUpdateOutbox';

export type ComputedUpdateWorkerParams = {
  workerId: string;
  limit: number;
  actorId?: ActorId;
};

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
    @inject(v2CoreTokens.computedFieldBackfillService)
    private readonly backfillService: IComputedFieldBackfillService
  ) {}

  async runOnce(params: ComputedUpdateWorkerParams): Promise<Result<number, DomainError>> {
    return safeTry<number, DomainError>(
      async function* (this: ComputedUpdateWorker) {
        const actorIdResult = params.actorId ? ok(params.actorId) : ActorId.create('system');
        if (actorIdResult.isErr()) return err(actorIdResult.error);

        const claimed = yield* await this.outbox.claimBatch({
          workerId: params.workerId,
          limit: params.limit,
        });

        if (claimed.length === 0) return ok(0);

        let processed = 0;
        for (const task of claimed) {
          // Handle field backfill tasks separately
          if (isFieldBackfillOutboxItem(task)) {
            const backfillResult = await this.processFieldBackfillTask(task, actorIdResult.value);
            if (backfillResult.isOk()) {
              processed += 1;
            }
            continue;
          }

          // Standard computed update task processing
          const runLogContext = {
            computedRunId: task.runId,
            computedOriginRunIds: task.originRunIds,
            computedTaskId: task.id,
          };
          const payload = toPayload(task);
          const planResult = deserializeComputedUpdatePlan(payload);
          if (planResult.isErr()) {
            this.logger.warn('computed:outbox:task_failed', {
              taskId: task.id,
              error: planResult.error.message,
              ...runLogContext,
            });
            await this.handleTaskFailure(task, planResult.error.message);
            continue;
          }

          const context: IExecutionContext = { actorId: actorIdResult.value };
          const totalSteps =
            task.runTotalSteps > 0
              ? task.runTotalSteps
              : task.runCompletedStepsBefore + task.steps.length;
          const runId = task.runId?.length ? task.runId : undefined;
          const originRunIds = task.originRunIds?.length ? task.originRunIds : undefined;

          const stageFieldIdsResult = collectSeedFieldIds(task);
          if (stageFieldIdsResult.isErr()) {
            this.logger.warn('computed:outbox:task_failed', {
              taskId: task.id,
              error: stageFieldIdsResult.error.message,
              ...runLogContext,
            });
            await this.handleTaskFailure(task, stageFieldIdsResult.error.message);
            continue;
          }

          const stageTableIdsResult = collectSeedTableIds(task);
          if (stageTableIdsResult.isErr()) {
            this.logger.warn('computed:outbox:task_failed', {
              taskId: task.id,
              error: stageTableIdsResult.error.message,
              ...runLogContext,
            });
            await this.handleTaskFailure(task, stageTableIdsResult.error.message);
            continue;
          }

          const executeResult = await this.unitOfWork.withTransaction(
            context,
            async (txContext) => {
              const run = createComputedUpdateRun({
                runId,
                originRunIds,
                totalSteps,
                completedStepsBefore: task.runCompletedStepsBefore,
                phase: 'async',
                taskId: task.id,
              });

              const lockResult = await this.updater.acquireLocks(planResult.value, txContext, {
                logContext: runLogContext,
              });
              if (lockResult.isErr()) return err(lockResult.error);

              const stageResult = await this.updater.execute(planResult.value, txContext, run);
              if (stageResult.isErr()) return err(stageResult.error);

              const completedStepsAfter = task.runCompletedStepsBefore + task.steps.length;
              const seedGroupsResult = await this.updater.collectDirtySeedGroups(
                txContext,
                stageTableIdsResult.value
              );
              if (seedGroupsResult.isErr()) return err(seedGroupsResult.error);

              const nextPlanResult = await this.planNextStage(
                planResult.value,
                txContext,
                stageFieldIdsResult.value,
                seedGroupsResult.value
              );
              if (nextPlanResult.isErr()) return err(nextPlanResult.error);

              if (nextPlanResult.value.steps.length > 0) {
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
                });

                const enqueueResult = await this.outbox.enqueueOrMerge(nextTask, txContext);
                if (enqueueResult.isErr()) return err(enqueueResult.error);
              }

              const doneResult = await this.outbox.markDone(task.id, txContext);
              if (doneResult.isErr()) return err(doneResult.error);

              return ok(undefined);
            }
          );
          if (executeResult.isErr()) {
            this.logger.warn('computed:outbox:task_failed', {
              taskId: task.id,
              error: executeResult.error.message,
              ...runLogContext,
            });
            await this.handleTaskFailure(task, executeResult.error.message);
            continue;
          }

          processed += 1;
        }

        return ok(processed);
      }.bind(this)
    );
  }

  private async handleTaskFailure(task: AnyOutboxItem, message: string) {
    const result = await this.outbox.markFailed(task, message);
    if (result.isErr()) {
      this.logger.warn('computed:outbox:markFailed_failed', {
        taskId: task.id,
        error: result.error.message,
      });
    }
  }

  /**
   * Process a field backfill task.
   * Loads the table, resolves field IDs, and executes the backfill.
   */
  private async processFieldBackfillTask(
    task: FieldBackfillOutboxItem,
    actorId: ActorId
  ): Promise<Result<void, DomainError>> {
    const context: IExecutionContext = { actorId };
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
      this.logger.warn('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: fieldIdsResult.error.message,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, fieldIdsResult.error.message);
      return err(fieldIdsResult.error);
    }

    // Parse table ID
    const tableIdResult = TableId.create(task.tableId);
    if (tableIdResult.isErr()) {
      this.logger.warn('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: tableIdResult.error.message,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, tableIdResult.error.message);
      return err(tableIdResult.error);
    }

    // Load table with fields
    const tableSpec = TableByIdSpec.create(tableIdResult.value);
    const tableResult = await this.tableRepository.findOne(context, tableSpec);
    if (tableResult.isErr()) {
      this.logger.warn('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: tableResult.error.message,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, tableResult.error.message);
      return err(tableResult.error);
    }

    const table = tableResult.value;
    if (!table) {
      const message = `Table not found: ${task.tableId}`;
      this.logger.warn('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: message,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, message);
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
      const doneResult = await this.outbox.markDone(task.id);
      return doneResult;
    }

    // Execute backfill within a transaction
    const executeResult = await this.unitOfWork.withTransaction(context, async (txContext) => {
      // Execute sync backfill for all fields
      const backfillResult = await this.backfillService.executeSyncMany(txContext, {
        table,
        fields: fieldsToBackfill,
      });
      if (backfillResult.isErr()) return backfillResult;

      // Mark task as done
      const doneResult = await this.outbox.markDone(task.id, txContext);
      if (doneResult.isErr()) return doneResult;

      return ok(undefined);
    });

    if (executeResult.isErr()) {
      this.logger.warn('computed:worker:field_backfill_failed', {
        taskId: task.id,
        error: executeResult.error.message,
        ...runLogContext,
      });
      await this.handleTaskFailure(task, executeResult.error.message);
      return err(executeResult.error);
    }

    this.logger.debug('computed:worker:field_backfill_done', {
      taskId: task.id,
      tableId: task.tableId,
      fieldCount: fieldsToBackfill.length,
      ...runLogContext,
    });

    return ok(undefined);
  }

  private async planNextStage(
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    seedFieldIds: ReadonlyArray<FieldId>,
    seedGroups: ReadonlyArray<ComputedSeedGroup>
  ): Promise<Result<ComputedUpdatePlan, DomainError>> {
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
        // After the initial insert is processed, subsequent stages should behave like updates.
        // This avoids re-planning seed-table computed fields on every async stage.
        changeType: plan.changeType === 'insert' ? 'update' : plan.changeType,
        impact: {
          valueFieldIds: seedFieldIds,
          linkFieldIds: [],
        },
      },
      context
    );
  }
}

const toPayload = (task: ComputedUpdateOutboxItem): ComputedUpdateOutboxPayload => ({
  baseId: task.baseId,
  seedTableId: task.seedTableId,
  seedRecordIds: task.seedRecordIds,
  extraSeedRecords: task.extraSeedRecords,
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
