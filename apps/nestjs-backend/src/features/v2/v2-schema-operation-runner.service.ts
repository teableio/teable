import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { metrics } from '@opentelemetry/api';
import * as Sentry from '@sentry/nestjs';
import {
  ActorId,
  type DomainError,
  type SchemaOperationClaimNextResult,
  type IExecutionContext,
  type SchemaOperationRecord,
  type SchemaOperationRunNextResult,
  type SchemaOperationRunnerService,
  v2CoreTokens,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import { CrossSpaceLinkConversionRecoveryService } from '../table-lifecycle/cross-space-link-conversion-recovery.service';
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
  private readonly schemaOperationOutcome = metrics
    .getMeter('teable-observability')
    .createCounter('teable.schema_operation.outcome', {
      description: 'Durable schema operation outcomes after persisted completion or failure',
    });
  private readonly logger = new Logger(V2SchemaOperationRunnerService.name);
  private readonly workerId = `schema-operation-${process.pid}`;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private stopped = false;

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly configService: ConfigService,
    private readonly pairRecovery: CrossSpaceLinkConversionRecoveryService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log('V2 schema operation runner disabled');
      return;
    }

    if (!(await this.resolveClaimRunner())) return;
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
    // Containers are disposable routing-cache entries. Never retain a runner
    // (and its database handles) across ticks or a storage cutover.
    const claimRunner = await this.resolveClaimRunner();
    if (!claimRunner) return;

    let processed = 0;
    const maxBatch = this.maxBatch;

    while (!this.stopped && processed < maxBatch) {
      const now = new Date();
      // schema_operation rows live in the meta database, so claiming is
      // identical on every container; the handler must run on the container
      // scoped to the operation's data database (BYODB), otherwise repair DDL
      // lands on the meta database and reads keep failing with 42P01.
      const claimed = await this.claimRunnableOperation(claimRunner, now);
      if (!claimed) return;

      if (claimed.value.status !== 'claimed') {
        return;
      }

      const outcome = await this.executeClaimedOperation(claimed.value.operation, now);
      if (outcome === 'stop') return;
      if (outcome === 'processed') processed += 1;
    }

    if (processed >= maxBatch) {
      this.logger.warn(
        `V2 schema operation runner reached max batch size: workerId=${this.workerId}, maxBatch=${maxBatch}`
      );
    }
  }

  private async claimRunnableOperation(runner: SchemaOperationRunnerService, now: Date) {
    let claimed: Result<SchemaOperationClaimNextResult, DomainError>;
    try {
      claimed = await runner.claimNext(this.createContext(), {
        workerId: this.workerId,
        now,
        staleRunningBefore: new Date(now.getTime() - this.staleRunningMs),
      });
    } catch {
      // Retirement can race this claim. Next tick resolves fresh handles;
      // do not replay an uncertain claim within this tick.
      this.logger.warn('V2 schema operation claim container became unavailable');
      return undefined;
    }
    if (claimed.isErr()) {
      this.logger.warn(`V2 schema operation runner failed to claim: ${claimed.error.message}`);
      return undefined;
    }
    return claimed;
  }

  private async executeClaimedOperation(
    operation: SchemaOperationRecord,
    now: Date
  ): Promise<'processed' | 'skipped' | 'stop'> {
    const runner = await this.resolveOperationRunner(operation);
    if (!runner) return 'skipped';
    const result = await runner.runOperation(this.createContext(), operation, { now });
    if (result.isErr()) {
      this.logger.warn(`V2 schema operation runner failed to run: ${result.error.message}`);
      return 'stop';
    }
    const value = result.value;
    if (!isWorkResult(value)) {
      this.logger.warn(
        `V2 schema operation runner skipped claimed operation: operationId=${operation.id}, reason=${value.reason}`
      );
      return 'stop';
    }
    if (operation.type === 'table.actor_columns.enable') {
      this.schemaOperationOutcome.add(1, {
        type: 'table.actor_columns.enable',
        status: value.status === 'completed' ? 'ready' : 'error',
      });
    }
    this.logWorkResult(value);
    return 'processed';
  }

  private async resolveClaimRunner(): Promise<SchemaOperationRunnerService | undefined> {
    try {
      const container = await this.v2ContainerService.getContainer();
      if (!container.isRegistered(v2CoreTokens.schemaOperationRunnerService)) {
        this.logger.warn('V2 schema operation runner service is not registered');
        return undefined;
      }
      const runner = container.resolve<SchemaOperationRunnerService>(
        v2CoreTokens.schemaOperationRunnerService
      );
      runner.registerHandler(this.pairRecovery);
      return runner;
    } catch {
      this.logger.warn('V2 schema operation claim container is unavailable');
      return undefined;
    }
  }

  private async resolveOperationRunner(
    operation: SchemaOperationRecord
  ): Promise<SchemaOperationRunnerService | undefined> {
    const baseId = operation.target.baseId;
    if (!baseId) {
      return this.resolveClaimRunner();
    }

    let container: DependencyContainer;
    try {
      container = await this.v2ContainerService.getContainerForBase(baseId);
    } catch (error) {
      this.logger.error(
        `V2 schema operation runner failed to resolve container for base ${baseId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return undefined;
    }

    if (!container.isRegistered(v2CoreTokens.schemaOperationRunnerService)) {
      this.logger.error(`V2 schema operation runner service is not registered for base ${baseId}`);
      return undefined;
    }
    const runner = container.resolve<SchemaOperationRunnerService>(
      v2CoreTokens.schemaOperationRunnerService
    );
    runner.registerHandler(this.pairRecovery);
    return runner;
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
    this.captureTerminalFailure(result);
  }

  private captureTerminalFailure(
    result: Extract<SchemaOperationRunNextResult, { status: 'failed' }>
  ) {
    if (!result.terminal) return;

    const operation = result.operation;
    const target = operation.target;
    const originalLastError = result.originalLastError ?? null;
    const runnerError = result.error.message;
    // Prefer the original failure for Sentry titles/grouping. Repair handlers often
    // overwrite last_error with a generic "cannot repair" reason that hides the
    // real root cause (e.g. double precision = text during computed backfill).
    const diagnosticMessage =
      originalLastError && originalLastError !== runnerError
        ? `${runnerError} | original: ${originalLastError}`
        : runnerError;

    Sentry.withScope((scope) => {
      scope.setLevel('error');
      scope.setTag('feature', 'v2-schema-operation-runner');
      scope.setTag('teable.version', 'v2');
      scope.setTag('schema_operation.id', operation.id);
      scope.setTag('schema_operation.type', operation.type);
      scope.setTag('schema_operation.status', operation.status);
      scope.setTag('schema_operation.phase', operation.phase);
      scope.setTag('schema_operation.terminal', String(result.terminal));
      scope.setTag('schema_operation.retryable', String(result.retryable));
      scope.setTag('schema_operation.created_by', operation.createdBy);
      if (target.baseId) {
        scope.setTag('base.id', target.baseId);
      }
      if (target.tableId) {
        scope.setTag('table.id', target.tableId);
      }
      scope.setFingerprint([
        'v2-schema-operation-runner',
        operation.type,
        originalLastError ?? runnerError,
      ]);
      scope.setContext('schema_operation', {
        id: operation.id,
        type: operation.type,
        status: operation.status,
        phase: operation.phase,
        attempts: operation.attempts,
        maxAttempts: operation.maxAttempts,
        idempotencyKey: operation.idempotencyKey,
        target,
        createdBy: operation.createdBy,
        lastError: operation.lastError,
        originalLastError,
        runnerError,
      });

      const error = new Error(diagnosticMessage);
      error.name = 'V2SchemaOperationFailure';
      Sentry.captureException(error);
    });
  }
}
