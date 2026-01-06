import type { ILogger } from '@teable/v2-core';
import { v2CoreTokens } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { ComputedUpdateWorker } from './ComputedUpdateWorker';

/**
 * Configuration for the polling service.
 */
export type ComputedUpdatePollingConfig = {
  /**
   * Whether to auto-start polling on construction.
   * Set to true for hybrid/external modes.
   */
  enabled: boolean;

  /**
   * Unique worker ID for this polling instance.
   */
  workerId: string;

  /**
   * Number of tasks to claim per poll.
   * @default 50
   */
  batchSize: number;

  /**
   * Poll interval in milliseconds.
   * @default 1000
   */
  pollIntervalMs: number;

  /**
   * Maximum consecutive errors before backing off.
   * @default 5
   */
  maxConsecutiveErrors: number;

  /**
   * Backoff duration after max errors (ms).
   * @default 30000
   */
  errorBackoffMs: number;
};

export const defaultPollingConfig: ComputedUpdatePollingConfig = {
  enabled: false, // Disabled by default, enabled for hybrid/external
  workerId: `computed-poll-${process.pid}`,
  batchSize: 50,
  pollIntervalMs: 1000,
  maxConsecutiveErrors: 5,
  errorBackoffMs: 30000,
};

/**
 * Hybrid mode config: inline push + background polling as fallback.
 */
export const hybridPollingConfig: ComputedUpdatePollingConfig = {
  ...defaultPollingConfig,
  enabled: true,
};

/**
 * External mode config: only polling, no inline push.
 */
export const externalPollingConfig: ComputedUpdatePollingConfig = {
  ...defaultPollingConfig,
  enabled: true,
  pollIntervalMs: 500, // More aggressive polling for external mode
};

/**
 * Background polling service for computed field updates.
 *
 * Uses `FOR UPDATE SKIP LOCKED` to safely run multiple instances.
 * Auto-starts if config.enabled is true.
 *
 * @example
 * ```typescript
 * // Auto-start on construction (if enabled)
 * const service = container.resolve(ComputedUpdatePollingService);
 *
 * // Or manually control
 * service.start();
 * await service.stop();
 * ```
 */
@injectable()
export class ComputedUpdatePollingService {
  private running = false;
  private stopRequested = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveErrors = 0;
  private currentPollPromise: Promise<void> | null = null;

  constructor(
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateWorker)
    private readonly worker: ComputedUpdateWorker,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePollingConfig)
    private readonly config: ComputedUpdatePollingConfig = defaultPollingConfig,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger
  ) {
    // Auto-start if enabled
    if (this.config.enabled) {
      // Use setImmediate to avoid blocking constructor
      setImmediate(() => this.start());
    }
  }

  /**
   * Start the polling loop.
   */
  start(): void {
    if (this.running) {
      this.logger.warn('computed:polling:already_running', {
        workerId: this.config.workerId,
      });
      return;
    }

    this.running = true;
    this.stopRequested = false;
    this.consecutiveErrors = 0;

    this.logger.info('computed:polling:started', {
      workerId: this.config.workerId,
      batchSize: this.config.batchSize,
      pollIntervalMs: this.config.pollIntervalMs,
    });

    this.currentPollPromise = this.poll();
  }

  /**
   * Stop the polling loop gracefully.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.logger.info('computed:polling:stopping', {
      workerId: this.config.workerId,
    });

    this.stopRequested = true;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.currentPollPromise) {
      await this.currentPollPromise;
    }

    this.running = false;

    this.logger.info('computed:polling:stopped', {
      workerId: this.config.workerId,
    });
  }

  /**
   * Check if polling is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Run a single poll iteration (for testing).
   */
  async runOnce(): Promise<number> {
    const result = await this.worker.runOnce({
      workerId: this.config.workerId,
      limit: this.config.batchSize,
    });

    if (result.isErr()) {
      this.logger.warn('computed:polling:runOnce_error', {
        workerId: this.config.workerId,
        error: result.error.message,
      });
      return 0;
    }

    return result.value;
  }

  private async poll(): Promise<void> {
    if (this.stopRequested) return;

    try {
      const result = await this.worker.runOnce({
        workerId: this.config.workerId,
        limit: this.config.batchSize,
      });

      if (result.isErr()) {
        this.consecutiveErrors++;
        this.logger.warn('computed:polling:poll_error', {
          workerId: this.config.workerId,
          error: result.error.message,
          consecutiveErrors: this.consecutiveErrors,
        });

        if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) {
          this.logger.warn('computed:polling:backing_off', {
            workerId: this.config.workerId,
            backoffMs: this.config.errorBackoffMs,
          });
          await new Promise((resolve) => setTimeout(resolve, this.config.errorBackoffMs));
          this.consecutiveErrors = 0;
        }
      } else {
        this.consecutiveErrors = 0;
        const processed = result.value;

        if (processed > 0) {
          this.logger.debug('computed:polling:processed', {
            workerId: this.config.workerId,
            count: processed,
          });
        }

        // If we processed a full batch, poll again immediately
        if (processed >= this.config.batchSize) {
          setImmediate(() => void this.poll());
          return;
        }
      }
    } catch (error) {
      this.consecutiveErrors++;
      this.logger.error('computed:polling:unexpected_error', {
        workerId: this.config.workerId,
        error: error instanceof Error ? error.message : String(error),
        consecutiveErrors: this.consecutiveErrors,
      });
    }

    // Schedule next poll
    if (!this.stopRequested) {
      this.pollTimer = setTimeout(() => void this.poll(), this.config.pollIntervalMs);
    }
  }
}
