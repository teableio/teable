import { getQueueToken } from '@nestjs/bullmq';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ComputedUpdateOutboxConfig } from '@teable/v2-adapter-table-repository-postgres';
import { Queue } from 'bullmq';

import {
  ComputedOutboxTriggerConfig,
  type IComputedOutboxTriggerConfig,
} from '../../../configs/computed-outbox-trigger.config';
import { COMPUTED_OUTBOX_WAKEUP_QUEUE } from './constants';

export const COMPUTED_OUTBOX_CLAIM_CONCURRENCY_MIN = 1;
/**
 * Hard ceiling for the runtime override. The claim caps bound how many
 * concurrent computed transactions one base can open against its data
 * database; anything beyond this should be a deliberate deploy-time decision
 * (env), not a dashboard tweak.
 */
export const COMPUTED_OUTBOX_CLAIM_CONCURRENCY_MAX = 16;
/** How often each process re-reads the Redis override and re-applies it. */
export const COMPUTED_OUTBOX_CLAIM_CONCURRENCY_POLL_MS = 15_000;

export type ComputedOutboxClaimConcurrencyOverride = {
  perBase: number | null;
  perSeedTable: number | null;
};

export type ComputedOutboxClaimConcurrencySnapshot = {
  /** The env-configured defaults of the process answering the request. */
  processDefault: { perBase: number; perSeedTable: number };
  /** Cluster-wide runtime override stored in Redis; null fields fall back to env. */
  override: ComputedOutboxClaimConcurrencyOverride;
  /** What primary-storage claim paths apply: override when set, otherwise env. */
  effective: { perBase: number; perSeedTable: number };
  min: number;
  max: number;
};

const resolveSettingKey = (): string => {
  const queuePrefix = process.env.BACKEND_QUEUE_PREFIX ?? 'bull';
  return `${queuePrefix}:${COMPUTED_OUTBOX_WAKEUP_QUEUE}:settings:claim-concurrency`;
};

export class ComputedOutboxClaimConcurrencyRangeError extends RangeError {
  constructor(field: string, value: number) {
    super(
      `Computed outbox claim concurrency ${field} must be an integer between ` +
        `${COMPUTED_OUTBOX_CLAIM_CONCURRENCY_MIN} and ${COMPUTED_OUTBOX_CLAIM_CONCURRENCY_MAX}, got ${value}`
    );
    this.name = 'ComputedOutboxClaimConcurrencyRangeError';
  }
}

const NO_OVERRIDE: ComputedOutboxClaimConcurrencyOverride = { perBase: null, perSeedTable: null };

/**
 * Cluster-wide runtime override for the outbox claim concurrency caps
 * (maxConcurrentProcessingPerBase / maxConcurrentProcessingPerSeedTable).
 * The value lives in Redis (same connection as the wake-up queue); every
 * process polls it and hot-applies it by mutating the live outbox config
 * objects registered by V2ContainerService — the claim SQL and deferral
 * checks read those fields per call, so no restart is involved.
 *
 * Only primary-storage containers register here: BYODB data pools are sized
 * against the env defaults at deploy time, so a dashboard tweak must not
 * widen their claim caps.
 */
@Injectable()
export class ComputedOutboxClaimConcurrencyService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ComputedOutboxClaimConcurrencyService.name);
  private readonly registeredConfigs = new Set<ComputedUpdateOutboxConfig>();
  private appliedOverride: ComputedOutboxClaimConcurrencyOverride = NO_OVERRIDE;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    @ComputedOutboxTriggerConfig()
    private readonly config: IComputedOutboxTriggerConfig,
    @Optional()
    @Inject(getQueueToken(COMPUTED_OUTBOX_WAKEUP_QUEUE))
    private readonly queue?: Queue
  ) {}

  onApplicationBootstrap(): void {
    if (!this.queue) return;
    this.schedulePoll(0);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  get processDefault(): { perBase: number; perSeedTable: number } {
    return {
      perBase: this.config.claimConcurrencyPerBase,
      perSeedTable: this.config.claimConcurrencyPerSeedTable,
    };
  }

  /** Last-known effective caps — synchronous so the admission hot path can read it. */
  get effective(): { perBase: number; perSeedTable: number } {
    const defaults = this.processDefault;
    return {
      perBase: this.appliedOverride.perBase ?? defaults.perBase,
      perSeedTable: this.appliedOverride.perSeedTable ?? defaults.perSeedTable,
    };
  }

  /**
   * Track a live outbox config for hot-apply and immediately bring it to the
   * current effective values. Returns an unregister callback for container
   * destruction.
   */
  registerOutboxConfig(config: ComputedUpdateOutboxConfig): () => void {
    this.registeredConfigs.add(config);
    this.applyTo(config);
    return () => {
      this.registeredConfigs.delete(config);
    };
  }

  /** Unset, unreadable, or corrupt values read as "no override". */
  async getOverride(): Promise<ComputedOutboxClaimConcurrencyOverride> {
    if (!this.queue) return NO_OVERRIDE;
    try {
      const client = await this.queue.client;
      return this.parseOverride(await client.get(resolveSettingKey()));
    } catch (error) {
      this.logger.warn('computed:outbox:claim_concurrency_read_failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return NO_OVERRIDE;
    }
  }

  async getSnapshot(): Promise<ComputedOutboxClaimConcurrencySnapshot> {
    return this.snapshot(await this.getOverride());
  }

  /**
   * Set the cluster-wide override; null fields (or a null body) fall back to
   * the env defaults. The caller's snapshot reflects the new value; other
   * processes converge on their next poll.
   */
  async setOverride(
    value: ComputedOutboxClaimConcurrencyOverride | null
  ): Promise<ComputedOutboxClaimConcurrencySnapshot> {
    if (!this.queue) throw new Error('BullMQ queue is not configured');
    const next = value ?? NO_OVERRIDE;
    for (const field of ['perBase', 'perSeedTable'] as const) {
      const fieldValue = next[field];
      if (fieldValue != null && !this.isInRange(fieldValue)) {
        throw new ComputedOutboxClaimConcurrencyRangeError(field, fieldValue);
      }
    }
    const client = await this.queue.client;
    if (next.perBase == null && next.perSeedTable == null) {
      await client.del(resolveSettingKey());
    } else {
      await client.set(resolveSettingKey(), JSON.stringify(next));
    }
    this.logger.log('computed:outbox:claim_concurrency_override', { override: next });
    this.applyOverride(next);
    return this.snapshot(next);
  }

  private schedulePoll(delayMs: number): void {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => {
      void this.poll();
    }, delayMs);
    this.pollTimer.unref?.();
  }

  private async poll(): Promise<void> {
    try {
      this.applyOverride(await this.getOverride());
    } finally {
      this.schedulePoll(COMPUTED_OUTBOX_CLAIM_CONCURRENCY_POLL_MS);
    }
  }

  private applyOverride(override: ComputedOutboxClaimConcurrencyOverride): void {
    const changed =
      override.perBase !== this.appliedOverride.perBase ||
      override.perSeedTable !== this.appliedOverride.perSeedTable;
    this.appliedOverride = override;
    if (!changed) return;
    for (const config of this.registeredConfigs) this.applyTo(config);
    this.logger.log('computed:outbox:claim_concurrency_applied', {
      effective: this.effective,
      configCount: this.registeredConfigs.size,
    });
  }

  private applyTo(config: ComputedUpdateOutboxConfig): void {
    const effective = this.effective;
    config.maxConcurrentProcessingPerBase = effective.perBase;
    config.maxConcurrentProcessingPerSeedTable = effective.perSeedTable;
  }

  private snapshot(
    override: ComputedOutboxClaimConcurrencyOverride
  ): ComputedOutboxClaimConcurrencySnapshot {
    const defaults = this.processDefault;
    return {
      processDefault: defaults,
      override,
      effective: {
        perBase: override.perBase ?? defaults.perBase,
        perSeedTable: override.perSeedTable ?? defaults.perSeedTable,
      },
      min: COMPUTED_OUTBOX_CLAIM_CONCURRENCY_MIN,
      max: COMPUTED_OUTBOX_CLAIM_CONCURRENCY_MAX,
    };
  }

  private parseOverride(raw: string | null): ComputedOutboxClaimConcurrencyOverride {
    if (raw == null || raw === '') return NO_OVERRIDE;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed == null) return NO_OVERRIDE;
      const record = parsed as Record<string, unknown>;
      return {
        perBase: this.parseField(record.perBase),
        perSeedTable: this.parseField(record.perSeedTable),
      };
    } catch {
      return NO_OVERRIDE;
    }
  }

  private parseField(value: unknown): number | null {
    return typeof value === 'number' && this.isInRange(value) ? value : null;
  }

  private isInRange(value: number): boolean {
    return (
      Number.isInteger(value) &&
      value >= COMPUTED_OUTBOX_CLAIM_CONCURRENCY_MIN &&
      value <= COMPUTED_OUTBOX_CLAIM_CONCURRENCY_MAX
    );
  }
}
