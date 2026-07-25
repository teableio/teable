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

/** Re-arms durable tasks at startup and performs a low-frequency actionable-only reconciliation. */
@Injectable()
export class ComputedOutboxRedriveService implements OnApplicationBootstrap, OnModuleDestroy {
  private static readonly reconcileIntervalMs = 5 * 60_000;
  private readonly logger = new Logger(ComputedOutboxRedriveService.name);
  private activeRun?: Promise<void>;
  private rerunRequested = false;
  private rerunFull = false;
  private stopped = false;
  private readonly targetRetries = new Map<string, { actionableOnly: boolean }>();
  private unsubscribeDeliveryRecovered?: () => void;
  private reconcileTimer?: ReturnType<typeof setInterval>;

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
    this.reconcileTimer = setInterval(
      this.requestActionableRedrive,
      ComputedOutboxRedriveService.reconcileIntervalMs
    );
    this.reconcileTimer.unref?.();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.unsubscribeDeliveryRecovered?.();
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
  }

  async runOnce(options: { actionableOnly?: boolean } = {}): Promise<void> {
    try {
      const acquired = await this.dataDbClientManager.withComputedOutboxRedriveLease(async () => {
        const targets = await this.dataDbClientManager.listComputedOutboxMaintenanceTargets();
        const counts = await mapWithConcurrency(
          targets,
          this.config.monitorConcurrency,
          async (target) => await this.redriveTarget(target, options.actionableOnly === true)
        );
        this.logger.log('computed:outbox:redrive_done', {
          targetCount: targets.length,
          published: counts.reduce((total, count) => total + count, 0),
        });
      });
      if (!acquired) {
        this.logger.debug('computed:outbox:redrive_lease_busy');
        await this.waitForRetry(500);
        if (!this.stopped) this.queueRerun(options.actionableOnly === true);
      }
    } catch (error) {
      this.logger.error('computed:outbox:redrive_failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private readonly requestRedrive = (): void => this.startRedrive(false);

  private readonly requestActionableRedrive = (): void => this.startRedrive(true);

  private startRedrive(actionableOnly: boolean): void {
    if (this.stopped || !this.canRedrive()) return;
    if (this.activeRun) {
      this.queueRerun(actionableOnly);
      return;
    }
    const run = this.runOnce({ actionableOnly }).finally(() => {
      if (this.activeRun !== run) return;
      this.activeRun = undefined;
      if (this.rerunRequested) {
        const rerunFull = this.rerunFull;
        this.rerunRequested = false;
        this.rerunFull = false;
        this.startRedrive(!rerunFull);
      }
    });
    this.activeRun = run;
  }

  private queueRerun(actionableOnly: boolean): void {
    this.rerunRequested = true;
    if (!actionableOnly) this.rerunFull = true;
  }

  private async redriveTarget(
    target: IComputedOutboxMaintenanceTarget,
    actionableOnly: boolean
  ): Promise<number> {
    try {
      return await this.scanTargetOnce(target, actionableOnly);
    } catch (error) {
      this.logger.warn('computed:outbox:redrive_target_deferred', {
        cacheKey: target.cacheKey,
        storage: target.storage,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      this.scheduleTargetRetry(target, actionableOnly);
      return 0;
    }
  }

  private scheduleTargetRetry(
    target: IComputedOutboxMaintenanceTarget,
    actionableOnly: boolean
  ): void {
    const existing = this.targetRetries.get(target.cacheKey);
    if (existing) {
      if (!actionableOnly) existing.actionableOnly = false;
      return;
    }
    const retryState = { actionableOnly };
    this.targetRetries.set(target.cacheKey, retryState);
    void this.retryTargetUntilAvailable(target, retryState).finally(() => {
      if (this.targetRetries.get(target.cacheKey) === retryState) {
        this.targetRetries.delete(target.cacheKey);
      }
    });
  }

  private async retryTargetUntilAvailable(
    target: IComputedOutboxMaintenanceTarget,
    retryState: { actionableOnly: boolean }
  ): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      await this.waitForRetry(Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
      try {
        await this.scanTargetOnce(target, retryState.actionableOnly);
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

  private async scanTargetOnce(
    target: IComputedOutboxMaintenanceTarget,
    actionableOnly: boolean
  ): Promise<number> {
    let published = 0;
    const iterator = actionableOnly
      ? this.dataDbClientManager.iterateComputedOutboxWakeupCandidates(
          target,
          defaultComputedUpdateOutboxConfig.processingLeaseMs,
          500,
          { actionableOnly: true }
        )
      : this.dataDbClientManager.iterateComputedOutboxWakeupCandidates(
          target,
          defaultComputedUpdateOutboxConfig.processingLeaseMs
        );
    for await (const candidates of iterator) {
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
      // Prefix v2 avoids completed cuwr-* jobs retained by pre-fix deployments.
      wakeupId: `cuwr2-${candidate.taskId}-${candidate.revision}`,
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
