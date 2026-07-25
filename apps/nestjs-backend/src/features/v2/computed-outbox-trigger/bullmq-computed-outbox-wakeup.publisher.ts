import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type {
  ComputedOutboxWakeup,
  ComputedOutboxWakeupSkipReason,
  IComputedOutboxWakeupPublisher,
} from '@teable/v2-adapter-table-repository-postgres';
import { Queue } from 'bullmq';

import { ComputedOutboxTriggerMetrics } from './computed-outbox-trigger.metrics';
import type { ComputedOutboxWakeupWire } from './computed-outbox-wakeup.wire';
import {
  COMPUTED_OUTBOX_COMPLETED_RETENTION_COUNT,
  COMPUTED_OUTBOX_WAKEUP_JOB,
  COMPUTED_OUTBOX_WAKEUP_QUEUE,
} from './constants';

@Injectable()
export class BullMqComputedOutboxWakeupPublisher implements IComputedOutboxWakeupPublisher {
  private readonly deliveryRecoveredListeners = new Set<() => void>();
  private activePublishCount = 0;
  private readonly publishWaiters: Array<() => void> = [];
  private recoveryProbe?: Promise<void>;

  constructor(
    @InjectQueue(COMPUTED_OUTBOX_WAKEUP_QUEUE)
    private readonly queue: Queue<ComputedOutboxWakeupWire>,
    private readonly metrics: ComputedOutboxTriggerMetrics,
    private readonly publishTimeoutMs = 1000,
    private readonly retryBaseDelayMs = 250,
    private readonly maxConcurrentPublishes = 8
  ) {}

  async publish(wakeup: ComputedOutboxWakeup): Promise<{ status: 'accepted' }> {
    const startedAt = performance.now();
    const releaseSlot = await this.acquirePublishSlot();
    try {
      if (this.recoveryProbe) throw new ComputedOutboxWakeupRecoveryInProgressError();
      const client = await this.queue.client;
      if (client.status !== 'ready') {
        const error = new ComputedOutboxWakeupRecoveryInProgressError();
        this.scheduleRecovery(wakeup, this.addWakeup(wakeup));
        throw error;
      }
      // Timeout is intentional fire-and-forget: a slow Redis that still completes
      // queue.add after the timeout will deliver the job (at-least-once). The caller
      // records timeout/error. Explicit Redis command failures are retried in the background;
      // the durable DB row and startup redrive cover process restarts.
      const operation = this.addWakeup(wakeup);
      try {
        await this.withTimeout(operation, this.publishTimeoutMs);
      } catch (error) {
        this.scheduleRecovery(wakeup, operation);
        throw error;
      }
      this.metrics.recordPublish('accepted', wakeup.cause);
      return { status: 'accepted' };
    } catch (error) {
      this.metrics.recordPublish(
        error instanceof ComputedOutboxWakeupPublishTimeoutError ? 'timeout' : 'error',
        wakeup.cause
      );
      throw error;
    } finally {
      releaseSlot();
      this.metrics.recordPublishDuration(performance.now() - startedAt);
    }
  }

  recordSkip(reason: ComputedOutboxWakeupSkipReason): void {
    this.metrics.recordPublishSkip(reason);
  }

  onDeliveryRecovered(listener: () => void): () => void {
    this.deliveryRecoveredListeners.add(listener);
    return () => this.deliveryRecoveredListeners.delete(listener);
  }

  private addWakeup(wakeup: ComputedOutboxWakeup) {
    const isDeterministic =
      wakeup.wakeupId.startsWith('cuwr2-') || wakeup.wakeupId.startsWith('cuwd-');
    return this.queue.add(
      COMPUTED_OUTBOX_WAKEUP_JOB,
      {
        schemaVersion: wakeup.schemaVersion,
        wakeupId: wakeup.wakeupId,
        taskId: wakeup.taskId,
        baseId: wakeup.baseId,
        availableAt: wakeup.availableAt.toISOString(),
        emittedAt: wakeup.emittedAt.toISOString(),
        cause: wakeup.cause,
      },
      {
        jobId: wakeup.wakeupId,
        delay: Math.max(0, wakeup.availableAt.getTime() - Date.now()),
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        // Deterministic locators must be addable again after the task advances or resumes.
        removeOnComplete: isDeterministic
          ? true
          : { count: COMPUTED_OUTBOX_COMPLETED_RETENTION_COUNT },
        removeOnFail: isDeterministic ? true : { count: 5000 },
      }
    );
  }

  private scheduleRecovery(
    wakeup: ComputedOutboxWakeup,
    initialOperation: ReturnType<BullMqComputedOutboxWakeupPublisher['addWakeup']>
  ): void {
    if (this.recoveryProbe) return;
    const probe = this.recoverDelivery(wakeup, initialOperation).finally(() => {
      if (this.recoveryProbe === probe) this.recoveryProbe = undefined;
    });
    this.recoveryProbe = probe;
  }

  private async recoverDelivery(
    wakeup: ComputedOutboxWakeup,
    initialOperation: ReturnType<BullMqComputedOutboxWakeupPublisher['addWakeup']>
  ): Promise<void> {
    try {
      await this.withTimeout(initialOperation, this.publishTimeoutMs * 2);
      this.metrics.recordPublish('accepted', wakeup.cause);
      this.notifyDeliveryRecovered();
      return;
    } catch {
      // The single probe below owns recovery. While it is active, new durable writes fail fast
      // instead of adding unbounded commands to ioredis's offline queue.
    }

    let attempt = 0;
    while (!this.queue.closing) {
      await this.waitForRetry(Math.min(30_000, this.retryBaseDelayMs * 2 ** Math.min(attempt, 8)));
      try {
        await this.withTimeout(this.addWakeup(wakeup), this.publishTimeoutMs * 2);
        this.metrics.recordPublish('accepted', wakeup.cause);
        this.notifyDeliveryRecovered();
        return;
      } catch {
        this.metrics.recordPublish('error', wakeup.cause);
        attempt += 1;
      }
    }
  }

  private notifyDeliveryRecovered(): void {
    for (const listener of this.deliveryRecoveredListeners) {
      try {
        listener();
      } catch {
        // Recovery remains successful even if an observer is shutting down.
      }
    }
  }

  private async acquirePublishSlot(): Promise<() => void> {
    if (this.activePublishCount >= this.maxConcurrentPublishes) {
      await new Promise<void>((resolve) => this.publishWaiters.push(resolve));
    } else {
      this.activePublishCount += 1;
    }
    return () => {
      const next = this.publishWaiters.shift();
      if (next) next();
      else this.activePublishCount -= 1;
    };
  }

  private async waitForRetry(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delayMs);
      timer.unref?.();
    });
  }

  private async withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new ComputedOutboxWakeupPublishTimeoutError(timeoutMs)),
        timeoutMs
      );
      timer.unref?.();
      operation.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }
}

export class ComputedOutboxWakeupPublishTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`BullMQ computed outbox wake-up publish timed out after ${timeoutMs}ms`);
    this.name = 'ComputedOutboxWakeupPublishTimeoutError';
  }
}

export class ComputedOutboxWakeupRecoveryInProgressError extends Error {
  constructor() {
    super('BullMQ computed outbox wake-up delivery recovery is in progress');
    this.name = 'ComputedOutboxWakeupRecoveryInProgressError';
  }
}
