import type { DomainError, FieldId, IExecutionContext, TableId } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type {
  ComputedFieldUpdater,
  ComputedUpdateResult,
  StepChangeData,
} from '../ComputedFieldUpdater';
import type {
  ComputedSeedGroup,
  ComputedUpdatePlan,
  ComputedUpdatePlanner,
} from '../ComputedUpdatePlanner';
import { splitSeedGroupsForPlan } from '../ComputedUpdatePlanner';
import { createComputedUpdateRun, toRunLogContext } from '../ComputedUpdateRun';
import type { IUpdateStrategy, UpdateStrategyMode } from './IUpdateStrategy';

/**
 * Synchronous strategy: execute computed updates in the current transaction.
 */
@injectable()
export class SyncInTransactionStrategy implements IUpdateStrategy {
  readonly name = 'sync';
  readonly mode: UpdateStrategyMode = 'sync';

  constructor(
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly planner: ComputedUpdatePlanner
  ) {}

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

    // Accumulate changes from all stages
    const allChangesByStep: StepChangeData[] = [];

    while (currentPlan.steps.length > 0) {
      const run = createComputedUpdateRun({
        runId,
        originRunIds,
        totalSteps,
        completedStepsBefore: completedSteps,
        phase: 'full',
      });
      const lockResult = await updater.acquireLocks(currentPlan, context, {
        logContext: toRunLogContext(run),
      });
      if (lockResult.isErr()) return err(lockResult.error);

      // Execute with collectChanges enabled to get the updated values
      const stageResult = await updater.execute(currentPlan, context, run, {
        collectChanges: true,
      });
      if (stageResult.isErr()) return err(stageResult.error);

      // Accumulate changes from this stage
      allChangesByStep.push(...stageResult.value.changesByStep);

      completedSteps += currentPlan.steps.length;

      // Record updated fields to avoid re-updating them in subsequent stages
      for (const step of currentPlan.steps) {
        for (const fieldId of step.fieldIds) {
          updatedFieldIds.add(fieldId.toString());
        }
      }

      const tableIds = collectStepTableIds(currentPlan);
      const seedGroups = await updater.collectDirtySeedGroups(context, tableIds);
      if (seedGroups.isErr()) return err(seedGroups.error);

      const nextSeedFieldIds = collectStepFieldIds(currentPlan);
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

    return ok({ changesByStep: allChangesByStep });
  }

  scheduleDispatch(_context: IExecutionContext): void {
    // No-op: Sync strategy does not use outbox
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
  return [...ids.values()];
};
