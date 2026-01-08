import {
  ActorId,
  type DomainError,
  FieldId,
  type IExecutionContext,
  type IHasher,
  type IUnitOfWork,
  type ILogger,
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
  type ComputedUpdateOutboxPayload,
} from '../outbox/ComputedUpdateOutboxPayload';
import {
  buildOutboxTaskInput,
  deserializeComputedUpdatePlan,
} from '../outbox/ComputedUpdateOutboxPayload';
import type { IComputedUpdateOutbox } from '../outbox/IComputedUpdateOutbox';

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
    private readonly hasher: IHasher
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

  private async handleTaskFailure(task: ComputedUpdateOutboxItem, message: string) {
    const result = await this.outbox.markFailed(task, message);
    if (result.isErr()) {
      this.logger.warn('computed:outbox:markFailed_failed', {
        taskId: task.id,
        error: result.error.message,
      });
    }
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
        changeType: plan.changeType,
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
