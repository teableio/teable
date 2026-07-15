import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  createComputedOutboxWakeup,
  defaultComputedUpdateOutboxConfig,
} from '@teable/v2-adapter-table-repository-postgres';

import {
  ComputedOutboxTriggerConfig,
  type IComputedOutboxTriggerConfig,
} from '../../../configs/computed-outbox-trigger.config';
import type { IComputedOutboxMaintenanceTarget } from '../../../global/data-db-client-manager.service';
import { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import { IComputedOutboxWakeupAppPublisher } from './computed-outbox-wakeup.publisher';
import { COMPUTED_OUTBOX_WAKEUP_PUBLISHER } from './constants';
import { mapWithConcurrency } from './map-with-concurrency';

/**
 * Re-arms durable tasks once at startup. Runtime publication failures are retried by the
 * BullMQ publisher itself, so this service never becomes a periodic database poller.
 */
@Injectable()
export class ComputedOutboxRedriveService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ComputedOutboxRedriveService.name);
  private activeRun?: Promise<void>;
  private rerunRequested = false;
  private stopped = false;
  private readonly targetRetries = new Map<string, Promise<void>>();
  private unsubscribeDeliveryRecovered?: () => void;

  constructor(
    @ComputedOutboxTriggerConfig()
    private readonly config: IComputedOutboxTriggerConfig,
    private readonly dataDbClientManager: DataDbClientManager,
    @Inject(COMPUTED_OUTBOX_WAKEUP_PUBLISHER)
    private readonly wakeupPublisher: IComputedOutboxWakeupAppPublisher
  ) {}

  onApplicationBootstrap(): void {
    if (!this.canRedrive()) return;
    this.unsubscribeDeliveryRecovered = this.wakeupPublisher.onDeliveryRecovered(
      this.requestRedrive
    );
    this.requestRedrive();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.unsubscribeDeliveryRecovered?.();
  }

  async runOnce(): Promise<void> {
    try {
      const acquired = await this.dataDbClientManager.withComputedOutboxRedriveLease(async () => {
        const targets = await this.dataDbClientManager.listComputedOutboxMaintenanceTargets();
        const counts = await mapWithConcurrency(
          targets,
          this.config.monitorConcurrency,
          async (target) => await this.redriveTarget(target)
        );
        this.logger.log('computed:outbox:redrive_done', {
          targetCount: targets.length,
          published: counts.reduce((total, count) => total + count, 0),
        });
      });
      if (!acquired) {
        this.logger.debug('computed:outbox:redrive_lease_busy');
        await this.waitForRetry(500);
        if (!this.stopped) this.rerunRequested = true;
      }
    } catch (error) {
      this.logger.error('computed:outbox:redrive_failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private readonly requestRedrive = (): void => {
    if (this.stopped || !this.canRedrive()) return;
    if (this.activeRun) {
      this.rerunRequested = true;
      return;
    }
    const run = this.runOnce().finally(() => {
      if (this.activeRun !== run) return;
      this.activeRun = undefined;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        this.requestRedrive();
      }
    });
    this.activeRun = run;
  };

  private async redriveTarget(target: IComputedOutboxMaintenanceTarget): Promise<number> {
    try {
      return await this.scanTargetOnce(target);
    } catch (error) {
      this.logger.warn('computed:outbox:redrive_target_deferred', {
        cacheKey: target.cacheKey,
        storage: target.storage,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      this.scheduleTargetRetry(target);
      return 0;
    }
  }

  private scheduleTargetRetry(target: IComputedOutboxMaintenanceTarget): void {
    if (this.targetRetries.has(target.cacheKey)) return;
    const retry = this.retryTargetUntilAvailable(target).finally(() => {
      if (this.targetRetries.get(target.cacheKey) === retry) {
        this.targetRetries.delete(target.cacheKey);
      }
    });
    this.targetRetries.set(target.cacheKey, retry);
  }

  private async retryTargetUntilAvailable(target: IComputedOutboxMaintenanceTarget): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      await this.waitForRetry(Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
      try {
        await this.scanTargetOnce(target);
        return;
      } catch (error) {
        this.logger.warn('computed:outbox:redrive_target_retry', {
          cacheKey: target.cacheKey,
          storage: target.storage,
          attempt,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        attempt += 1;
      }
    }
  }

  private async scanTargetOnce(target: IComputedOutboxMaintenanceTarget): Promise<number> {
    let published = 0;
    for await (const candidates of this.dataDbClientManager.iterateComputedOutboxWakeupCandidates(
      target,
      defaultComputedUpdateOutboxConfig.processingLeaseMs
    )) {
      if (this.stopped) return published;
      for (const candidate of candidates) {
        if (await this.publishCandidate(candidate)) published += 1;
      }
    }
    return published;
  }

  private async waitForRetry(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delayMs);
      timer.unref?.();
    });
  }

  private async publishCandidate(candidate: {
    taskId: string;
    baseId: string;
    availableAt: Date;
    revision: string;
  }): Promise<boolean> {
    const wakeup = createComputedOutboxWakeup({
      ...candidate,
      wakeupId: `cuwr-${candidate.taskId}-${candidate.revision}`,
      cause: 'replay',
    });
    try {
      const outcome = await this.wakeupPublisher.runAsConsumer(() =>
        this.wakeupPublisher.publish(wakeup)
      );
      return outcome.status === 'accepted';
    } catch (error) {
      this.logger.warn('computed:outbox:redrive_publish_deferred', {
        taskId: candidate.taskId,
        baseId: candidate.baseId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      // The publisher's single recovery probe will trigger another durable redrive after Redis
      // accepts a command. Moving on keeps one bad command from blocking the current target.
      return false;
    }
  }

  private canRedrive(): boolean {
    return this.config.producerEnabled || this.config.consumerEnabled;
  }
}
