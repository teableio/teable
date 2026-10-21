import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
import { mapWithConcurrency } from '../../../utils/map-with-concurrency';
import { DataDbHealthService } from '../../space/data-db-health.service';
import { IComputedOutboxWakeupAppPublisher } from './computed-outbox-wakeup.publisher';
import { COMPUTED_OUTBOX_WAKEUP_PUBLISHER } from './constants';

// Beyond every legitimate scheduling horizon (failure backoff caps at 300s,
// lock-miss requeues at sub-second): a pending row future-dated past this with
// no active pause scope covering it can only be a pause-deferral orphan.
const ORPHANED_DEFERRAL_THRESHOLD_MS = 10 * 60_000;

/**
 * Re-arms durable tasks at startup and performs a low-frequency actionable-only
 * reconciliation. BYODB targets are gated on the connection health lane first:
 * a read-only or unreachable database cannot persist claims, attempt counters,
 * or dead letters, so sweeping it would republish wake-ups every cycle that the
 * consumer immediately parks again. Such targets are skipped until health
 * reports them writable, which upgrades that cycle to a full re-arm so
 * scheduled tasks whose wake-ups were dropped while skipped come back too.
 */
@Injectable()
export class ComputedOutboxRedriveService implements OnApplicationBootstrap, OnModuleDestroy {
  private static readonly reconcileIntervalMs = 5 * 60_000;
  private readonly logger = new Logger(ComputedOutboxRedriveService.name);
  private activeRun?: Promise<void>;
  private rerunRequested = false;
  private rerunFull = false;
  private stopped = false;
  private readonly targetRetries = new Map<string, { actionableOnly: boolean }>();
  private readonly unhealthyTargetKeys = new Set<string>();
  private unsubscribeDeliveryRecovered?: () => void;
  private unsubscribeHealthRecovered?: () => void;
  private reconcileTimer?: ReturnType<typeof setInterval>;

  constructor(
    @ComputedOutboxTriggerConfig()
    private readonly config: IComputedOutboxTriggerConfig,
    private readonly dataDbClientManager: DataDbClientManager,
    @Inject(COMPUTED_OUTBOX_WAKEUP_PUBLISHER)
    private readonly wakeupPublisher: IComputedOutboxWakeupAppPublisher,
    @Optional() private readonly dataDbHealth?: DataDbHealthService
  ) {}

  onApplicationBootstrap(): void {
    if (!this.canRedrive()) return;
    this.unsubscribeDeliveryRecovered = this.wakeupPublisher.onDeliveryRecovered(
      this.requestRedrive
    );
    this.unsubscribeHealthRecovered = this.dataDbHealth?.onRecovered(this.requestRedrive);
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
    this.unsubscribeHealthRecovered?.();
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

  /**
   * Consults the shared connection health lane (30s-cached meta-DB lookup, no
   * customer-DB round-trip). 'untracked' and 'degraded' scan normally: health
   * must never silently starve a target it cannot classify.
   */
  private async resolveTargetScanMode(
    target: IComputedOutboxMaintenanceTarget,
    actionableOnly: boolean
  ): Promise<{ scan: boolean; actionableOnly: boolean }> {
    if (target.storage !== 'byodb' || !target.connectionId || !this.dataDbHealth) {
      return { scan: true, actionableOnly };
    }

    const health = await this.dataDbHealth.getHealthStateForConnection(target.connectionId);
    if (health === 'read_only' || health === 'unreachable') {
      if (!this.unhealthyTargetKeys.has(target.cacheKey)) {
        this.unhealthyTargetKeys.add(target.cacheKey);
        this.logger.warn('computed:outbox:redrive_target_unhealthy', {
          cacheKey: target.cacheKey,
          storage: target.storage,
          healthState: health,
        });
      } else {
        this.logger.debug('computed:outbox:redrive_target_unhealthy_skipped', {
          cacheKey: target.cacheKey,
          healthState: health,
        });
      }
      return { scan: false, actionableOnly };
    }

    if (this.unhealthyTargetKeys.delete(target.cacheKey)) {
      this.logger.log('computed:outbox:redrive_target_health_recovered', {
        cacheKey: target.cacheKey,
        healthState: health,
      });
      // Scheduled (not-yet-due) tasks lost their wake-ups while the target was
      // skipped, so recovery re-arms everything rather than actionable rows only.
      return { scan: true, actionableOnly: false };
    }
    return { scan: true, actionableOnly };
  }

  private async scanTargetOnce(
    target: IComputedOutboxMaintenanceTarget,
    requestedActionableOnly: boolean
  ): Promise<number> {
    const scanMode = await this.resolveTargetScanMode(target, requestedActionableOnly);
    if (!scanMode.scan) return 0;
    const actionableOnly = scanMode.actionableOnly;

    // Pause-deferral orphans first: rows future-dated past every legitimate
    // schedule with no active pause covering them are invisible to both the
    // claim scan and the candidate query below (next_run_at keyed), so the
    // sweep must pull them back to due before scanning or they stall forever
    // (T6648). Failure backoff caps at 5 minutes, so the threshold cannot
    // resurrect a legitimately backed-off task early.
    try {
      const restored = await this.dataDbClientManager.restoreOrphanedComputedOutboxDeferrals(
        target,
        ORPHANED_DEFERRAL_THRESHOLD_MS
      );
      if (restored > 0) {
        this.logger.warn('computed:outbox:redrive_orphaned_deferrals_restored', {
          cacheKey: target.cacheKey,
          storage: target.storage,
          restored,
        });
      }
    } catch (error) {
      this.logger.warn('computed:outbox:redrive_orphan_restore_failed', {
        cacheKey: target.cacheKey,
        storage: target.storage,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }

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
    const maxPublish = this.config.redriveMaxPublishPerTarget;
    for await (const candidates of iterator) {
      if (this.stopped) return published;
      for (const candidate of candidates) {
        if (await this.publishCandidate(candidate)) published += 1;
        if (published >= maxPublish) {
          // Backlog exceeds one sweep's budget — stop here and let the next
          // reconcile cycle continue instead of flooding the claim path.
          this.logger.warn('computed:outbox:redrive_publish_capped', {
            cacheKey: target.cacheKey,
            storage: target.storage,
            published,
            maxPublish,
          });
          return published;
        }
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
