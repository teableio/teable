import {
  type DomainError,
  type IExecutionContext,
  type IHasher,
  type ILogger,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { ComputedFieldUpdater, PreparedDirtyState } from '../ComputedFieldUpdater';
import type { ComputedUpdatePlan, UpdateStep } from '../ComputedUpdatePlanner';
import { buildOutboxTaskInput } from '../outbox/ComputedUpdateOutboxPayload';
import type { IComputedUpdateOutbox } from '../outbox/IComputedUpdateOutbox';
import type { IUpdateStrategy } from './IUpdateStrategy';

export type HybridWithOutboxStrategyConfig = {
  syncMaxDirtyPerTable: number;
  syncMaxTotalDirty: number;
  syncMaxLevelHardCap: number;
};

export const defaultHybridWithOutboxStrategyConfig: HybridWithOutboxStrategyConfig = {
  syncMaxDirtyPerTable: 2000,
  syncMaxTotalDirty: 5000,
  syncMaxLevelHardCap: 1,
};

/**
 * Hybrid strategy: sync dependency-safe levels, enqueue heavy levels to outbox.
 *
 * Example
 * ```typescript
 * const strategy = new HybridWithOutboxStrategy(outbox, config, logger);
 * await strategy.execute(updater, plan, context);
 * ```
 */
@injectable()
export class HybridWithOutboxStrategy implements IUpdateStrategy {
  readonly name = 'hybrid';

  constructor(
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateOutbox)
    private readonly outbox: IComputedUpdateOutbox,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateHybridConfig)
    private readonly config: HybridWithOutboxStrategyConfig = defaultHybridWithOutboxStrategyConfig,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2CoreTokens.hasher)
    private readonly hasher: IHasher
  ) {}

  async execute(
    updater: ComputedFieldUpdater,
    plan: ComputedUpdatePlan,
    context: IExecutionContext
  ): Promise<Result<void, DomainError>> {
    if (
      plan.steps.length === 0 ||
      (plan.seedRecordIds.length === 0 && plan.extraSeedRecords.length === 0)
    ) {
      return ok(undefined);
    }

    const prepared = await updater.prepareDirtyState(plan, context);
    if (prepared.isErr()) return err(prepared.error);

    const { syncSteps, asyncSteps, syncMaxLevel } = splitStepsByThreshold(
      plan,
      prepared.value,
      this.config
    );

    const syncResult = await updater.executePreparedSteps(plan, context, prepared.value, syncSteps);
    if (syncResult.isErr()) return err(syncResult.error);

    if (asyncSteps.length === 0) {
      return ok(undefined);
    }

    const asyncPlan: ComputedUpdatePlan = {
      ...plan,
      steps: asyncSteps,
    };

    const task = buildOutboxTaskInput({
      plan: asyncPlan,
      dirtyStats: prepared.value.dirtyStats,
      syncMaxLevel,
      hasher: this.hasher,
    });

    const enqueueResult = await this.outbox.enqueueOrMerge(task, context);
    if (enqueueResult.isErr()) {
      this.logger.warn('computed:outbox:enqueue_failed', {
        error: enqueueResult.error.message,
        planHash: task.planHash,
      });
      return ok(undefined);
    }

    this.logger.debug('computed:outbox:enqueued', {
      taskId: enqueueResult.value.taskId,
      merged: enqueueResult.value.merged,
      asyncStepCount: asyncSteps.length,
    });

    return ok(undefined);
  }
}

const splitStepsByThreshold = (
  plan: ComputedUpdatePlan,
  prepared: PreparedDirtyState,
  config: HybridWithOutboxStrategyConfig
): {
  syncSteps: ReadonlyArray<UpdateStep>;
  asyncSteps: ReadonlyArray<UpdateStep>;
  syncMaxLevel: number;
} => {
  const seedTableId = plan.seedTableId.toString();
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
