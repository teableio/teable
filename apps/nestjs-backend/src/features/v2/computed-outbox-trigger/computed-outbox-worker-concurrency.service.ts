import { getQueueToken } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  ComputedOutboxTriggerConfig,
  type IComputedOutboxTriggerConfig,
} from '../../../configs/computed-outbox-trigger.config';
import { COMPUTED_OUTBOX_WAKEUP_QUEUE } from './constants';

export const COMPUTED_OUTBOX_WORKER_CONCURRENCY_MIN = 1;
/**
 * Hard ceiling for the runtime override. Computed tasks are DB-heavy; anything
 * beyond this should be a deliberate deploy-time decision, not a dashboard
 * tweak.
 */
export const COMPUTED_OUTBOX_WORKER_CONCURRENCY_MAX = 64;

export type ComputedOutboxWorkerConcurrencySnapshot = {
  /** The env-configured per-process default of the process answering the request. */
  processDefault: number;
  /** Cluster-wide runtime override stored in Redis, or null when unset. */
  override: number | null;
  /** What consumers will apply: override when set, otherwise their env default. */
  effective: number;
  min: number;
  max: number;
};

const resolveSettingKey = (): string => {
  const queuePrefix = process.env.BACKEND_QUEUE_PREFIX ?? 'bull';
  return `${queuePrefix}:${COMPUTED_OUTBOX_WAKEUP_QUEUE}:settings:worker-concurrency`;
};

export class ComputedOutboxWorkerConcurrencyRangeError extends RangeError {
  constructor(value: number) {
    super(
      `Computed outbox worker concurrency must be an integer between ` +
        `${COMPUTED_OUTBOX_WORKER_CONCURRENCY_MIN} and ${COMPUTED_OUTBOX_WORKER_CONCURRENCY_MAX}, got ${value}`
    );
    this.name = 'ComputedOutboxWorkerConcurrencyRangeError';
  }
}

/**
 * Cluster-wide runtime override for the BullMQ wake-up worker concurrency.
 * The value lives in Redis (same connection as the queue); every consumer
 * process polls it and hot-applies it to its Worker without a restart.
 */
@Injectable()
export class ComputedOutboxWorkerConcurrencyService {
  private readonly logger = new Logger(ComputedOutboxWorkerConcurrencyService.name);

  constructor(
    @ComputedOutboxTriggerConfig()
    private readonly config: IComputedOutboxTriggerConfig,
    @Optional()
    @Inject(getQueueToken(COMPUTED_OUTBOX_WAKEUP_QUEUE))
    private readonly queue?: Queue
  ) {}

  get processDefault(): number {
    return this.config.concurrency;
  }

  /** Null when unset, unreadable, or out of range — callers fall back to the env default. */
  async getOverride(): Promise<number | null> {
    if (!this.queue) return null;
    try {
      const client = await this.queue.client;
      return this.parseOverride(await client.get(resolveSettingKey()));
    } catch (error) {
      this.logger.warn('computed:outbox:worker_concurrency_read_failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return null;
    }
  }

  async getSnapshot(): Promise<ComputedOutboxWorkerConcurrencySnapshot> {
    return this.snapshot(await this.getOverride());
  }

  /** Set the cluster-wide override, or clear it with null to fall back to env defaults. */
  async setOverride(value: number | null): Promise<ComputedOutboxWorkerConcurrencySnapshot> {
    if (!this.queue) throw new Error('BullMQ queue is not configured');
    if (value != null && this.parseOverride(String(value)) == null) {
      throw new ComputedOutboxWorkerConcurrencyRangeError(value);
    }
    const client = await this.queue.client;
    if (value == null) await client.del(resolveSettingKey());
    else await client.set(resolveSettingKey(), String(value));
    this.logger.log('computed:outbox:worker_concurrency_override', { override: value });
    return this.snapshot(value);
  }

  private snapshot(override: number | null): ComputedOutboxWorkerConcurrencySnapshot {
    return {
      processDefault: this.processDefault,
      override,
      effective: override ?? this.processDefault,
      min: COMPUTED_OUTBOX_WORKER_CONCURRENCY_MIN,
      max: COMPUTED_OUTBOX_WORKER_CONCURRENCY_MAX,
    };
  }

  private parseOverride(raw: string | null): number | null {
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    if (
      !Number.isInteger(value) ||
      value < COMPUTED_OUTBOX_WORKER_CONCURRENCY_MIN ||
      value > COMPUTED_OUTBOX_WORKER_CONCURRENCY_MAX
    ) {
      return null;
    }
    return value;
  }
}
