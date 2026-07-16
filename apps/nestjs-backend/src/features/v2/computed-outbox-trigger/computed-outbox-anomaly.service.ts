import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  createComputedOutboxWakeup,
  defaultComputedUpdateOutboxConfig,
} from '@teable/v2-adapter-table-repository-postgres';

import type {
  IComputedOutboxMaintenanceAnomaly,
  IComputedOutboxMaintenanceTarget,
} from '../../../global/data-db-client-manager.service';
import { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import { IComputedOutboxWakeupAppPublisher } from './computed-outbox-wakeup.publisher';
import { COMPUTED_OUTBOX_WAKEUP_PUBLISHER } from './constants';
import { mapWithConcurrency } from './map-with-concurrency';

export type ComputedOutboxAnomaly = IComputedOutboxMaintenanceAnomaly & {
  targetId: string;
  storage: IComputedOutboxMaintenanceTarget['storage'];
};

@Injectable()
export class ComputedOutboxAnomalyService {
  private readonly logger = new Logger(ComputedOutboxAnomalyService.name);

  constructor(
    private readonly dataDbClientManager: DataDbClientManager,
    @Inject(COMPUTED_OUTBOX_WAKEUP_PUBLISHER)
    private readonly wakeupPublisher: IComputedOutboxWakeupAppPublisher
  ) {}

  async list(limit: number): Promise<{
    sampledAt: string;
    total: number;
    items: ComputedOutboxAnomaly[];
    unavailableTargetCount: number;
  }> {
    const targets = await this.dataDbClientManager.listComputedOutboxMaintenanceTargets();
    const results = await mapWithConcurrency(targets, 4, async (target) => {
      try {
        const snapshot = await this.dataDbClientManager.listComputedOutboxMaintenanceAnomalies(
          target,
          defaultComputedUpdateOutboxConfig.processingLeaseMs,
          limit
        );
        return { target, snapshot };
      } catch (error) {
        this.logger.warn('computed:outbox:anomaly_target_failed', {
          targetId: target.cacheKey,
          storage: target.storage,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        return { target };
      }
    });

    return {
      sampledAt: new Date().toISOString(),
      total: results.reduce((sum, result) => sum + (result.snapshot?.total ?? 0), 0),
      items: results
        .flatMap((result) =>
          (result.snapshot?.items ?? []).map((item) => ({
            ...item,
            targetId: result.target.cacheKey,
            storage: result.target.storage,
          }))
        )
        .sort(
          (left, right) =>
            right.occurredAt.getTime() - left.occurredAt.getTime() ||
            left.taskId.localeCompare(right.taskId)
        )
        .slice(0, limit),
      unavailableTargetCount: results.filter((result) => !result.snapshot).length,
    };
  }

  async recover(input: { targetId: string; taskId: string; kind: 'dead' | 'stale' }): Promise<{
    taskId: string;
    kind: 'dead' | 'stale';
    recovered: true;
    delivery: 'accepted' | 'deferred';
  }> {
    const targets = await this.dataDbClientManager.listComputedOutboxMaintenanceTargets();
    const target = targets.find((candidate) => candidate.cacheKey === input.targetId);
    if (!target) throw new NotFoundException('Computed outbox storage target not found');

    const recovery = await this.dataDbClientManager.recoverComputedOutboxMaintenanceAnomaly(
      target,
      input.taskId,
      input.kind,
      defaultComputedUpdateOutboxConfig.processingLeaseMs
    );
    if (recovery.status !== 'recovered') {
      if (recovery.status === 'conflict') {
        throw new ConflictException('An equivalent pending computed task already exists');
      }
      throw new NotFoundException('Computed outbox anomaly no longer exists');
    }

    let delivery: 'accepted' | 'deferred' = 'deferred';
    try {
      const outcome = await this.wakeupPublisher.runAsConsumer(() =>
        this.wakeupPublisher.publish(
          createComputedOutboxWakeup({
            taskId: input.taskId,
            baseId: recovery.baseId,
            availableAt: new Date(),
            cause: 'replay',
          })
        )
      );
      if (outcome.status === 'accepted') delivery = 'accepted';
    } catch (error) {
      this.logger.warn('computed:outbox:anomaly_publish_deferred', {
        taskId: input.taskId,
        kind: input.kind,
        targetId: input.targetId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    this.logger.log('computed:outbox:anomaly_recovered', {
      taskId: input.taskId,
      kind: input.kind,
      targetId: input.targetId,
      delivery,
    });
    return { taskId: input.taskId, kind: input.kind, recovered: true, delivery };
  }
}
