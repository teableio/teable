import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActorId,
  type IExecutionContext,
  type SchemaOperationRunNextResult,
  type SchemaOperationRunnerService,
  v2CoreTokens,
} from '@teable/v2-core';

import { V2ContainerService } from './v2-container.service';

const enabledKey = 'V2_SCHEMA_OPERATION_RUNNER_ENABLED';
const pollIntervalMsKey = 'V2_SCHEMA_OPERATION_RUNNER_POLL_INTERVAL_MS';
const staleRunningMsKey = 'V2_SCHEMA_OPERATION_RUNNER_STALE_RUNNING_MS';
const maxBatchKey = 'V2_SCHEMA_OPERATION_RUNNER_MAX_BATCH';

const defaultPollIntervalMs = 5_000;
const defaultStaleRunningMs = 5 * 60_000;
const defaultMaxBatch = 20;

const systemActorId = ActorId.create('system')._unsafeUnwrap();

const parseBoolean = (value: unknown, defaultValue: boolean): boolean => {
  if (value == null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const parsePositiveInteger = (value: unknown, defaultValue: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.floor(parsed);
};

const isWorkResult = (
  result: SchemaOperationRunNextResult
): result is Extract<SchemaOperationRunNextResult, { status: 'completed' | 'failed' }> =>
  result.status === 'completed' || result.status === 'failed';

@Injectable()
export class V2SchemaOperationRunnerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(V2SchemaOperationRunnerService.name);
  private readonly workerId = `schema-operation-${process.pid}`;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private stopped = false;
  private runner?: SchemaOperationRunnerService;

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly configService: ConfigService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log('V2 schema operation runner disabled');
      return;
    }

    const container = await this.v2ContainerService.getContainer();
    if (!container.isRegistered(v2CoreTokens.schemaOperationRunnerService)) {
      this.logger.warn('V2 schema operation runner service is not registered');
      return;
    }

    this.runner = container.resolve<SchemaOperationRunnerService>(
      v2CoreTokens.schemaOperationRunnerService
    );
    this.stopped = false;
    this.schedule(0);
    this.logger.log(
      `V2 schema operation runner started: workerId=${this.workerId}, pollIntervalMs=${this.pollIntervalMs}, staleRunningMs=${this.staleRunningMs}`
    );
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private get pollIntervalMs(): number {
    return parsePositiveInteger(this.configService.get(pollIntervalMsKey), defaultPollIntervalMs);
  }

  private get staleRunningMs(): number {
    return parsePositiveInteger(this.configService.get(staleRunningMsKey), defaultStaleRunningMs);
  }

  private get maxBatch(): number {
    return parsePositiveInteger(this.configService.get(maxBatchKey), defaultMaxBatch);
  }

  private isEnabled(): boolean {
    return parseBoolean(this.configService.get(enabledKey), true);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;

    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;

    if (this.running) {
      this.schedule(this.pollIntervalMs);
      return;
    }

    this.running = true;
    try {
      await this.drainRunnableOperations();
    } catch (error) {
      this.logger.error(
        `V2 schema operation runner tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined
      );
    } finally {
      this.running = false;
      this.schedule(this.pollIntervalMs);
    }
  }

  private async drainRunnableOperations(): Promise<void> {
    if (!this.runner) return;

    let processed = 0;
    const maxBatch = this.maxBatch;

    while (!this.stopped && processed < maxBatch) {
      const now = new Date();
      const result = await this.runner.runNext(this.createContext(), {
        workerId: this.workerId,
        now,
        staleRunningBefore: new Date(now.getTime() - this.staleRunningMs),
      });

      if (result.isErr()) {
        this.logger.warn(`V2 schema operation runner failed to claim/run: ${result.error.message}`);
        return;
      }

      const value = result.value;
      if (!isWorkResult(value)) {
        return;
      }

      processed += 1;
      this.logWorkResult(value);
    }

    if (processed >= maxBatch) {
      this.logger.warn(
        `V2 schema operation runner reached max batch size: workerId=${this.workerId}, maxBatch=${maxBatch}`
      );
    }
  }

  private createContext(): IExecutionContext {
    return {
      actorId: systemActorId,
      requestId: `${this.workerId}:${Date.now()}`,
    };
  }

  private logWorkResult(
    result: Extract<SchemaOperationRunNextResult, { status: 'completed' | 'failed' }>
  ) {
    if (result.status === 'completed') {
      this.logger.log(`V2 schema operation completed: operationId=${result.operation.id}`);
      return;
    }

    const level = result.terminal ? 'error' : 'warn';
    this.logger[level](
      `V2 schema operation failed: operationId=${result.operation.id}, terminal=${result.terminal}, retryable=${result.retryable}, error=${result.error.message}`
    );
  }
}
