import {
  ActorId,
  type DomainError,
  type IExecutionContext,
  type ILogger,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import { ComputedFieldUpdater } from '../ComputedFieldUpdater';
import {
  deserializeComputedUpdatePlan,
  type ComputedUpdateOutboxPayload,
  ComputedUpdateOutboxItem,
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
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger
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
          const payload = toPayload(task);
          const planResult = deserializeComputedUpdatePlan(payload);
          if (planResult.isErr()) {
            await this.handleTaskFailure(task, planResult.error.message);
            continue;
          }

          const context: IExecutionContext = { actorId: actorIdResult.value };
          const executeResult = await this.updater.execute(planResult.value, context);
          if (executeResult.isErr()) {
            await this.handleTaskFailure(task, executeResult.error.message);
            continue;
          }

          const doneResult = await this.outbox.markDone(task.id);
          if (doneResult.isErr()) {
            this.logger.warn('computed:outbox:markDone_failed', {
              taskId: task.id,
              error: doneResult.error.message,
            });
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
