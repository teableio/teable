import 'reflect-metadata';

import type { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import {
  domainError,
  type SchemaOperationClaimNextResult,
  type SchemaOperationRecord,
  type SchemaOperationRunNextResult,
  v2CoreTokens,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { V2ContainerService } from './v2-container.service';
import { V2SchemaOperationRunnerService } from './v2-schema-operation-runner.service';

const sentryScope = {
  setContext: vi.fn(),
  setFingerprint: vi.fn(),
  setLevel: vi.fn(),
  setTag: vi.fn(),
};

vi.mock('@sentry/nestjs', () => ({
  captureException: vi.fn(),
  withScope: vi.fn((callback: (scope: typeof sentryScope) => void) => callback(sentryScope)),
}));

const operation = (
  id: string,
  baseId: string | null = 'bseSchemaOpRunner'
): SchemaOperationRecord =>
  ({
    id,
    type: 'table.create',
    status: 'running',
    phase: 'running',
    target: {
      resourceType: 'table',
      resourceId: 'tblSchemaOpRunner',
      baseId,
      tableId: 'tblSchemaOpRunner',
    },
    idempotencyKey: `schema-op:${id}`,
    attempts: 0,
    maxAttempts: 8,
    nextRunAt: new Date('2026-04-28T00:00:00.000Z'),
    createdTime: new Date('2026-04-28T00:00:00.000Z'),
    createdBy: 'system',
  }) as SchemaOperationRecord;

type OkResult<T> = {
  isErr: () => false;
  value: T;
};

const okClaim = (
  value: SchemaOperationClaimNextResult
): OkResult<SchemaOperationClaimNextResult> => ({
  isErr: () => false,
  value,
});

const okRun = (value: SchemaOperationRunNextResult): OkResult<SchemaOperationRunNextResult> => ({
  isErr: () => false,
  value,
});

const idleClaim = okClaim({ status: 'idle', reason: 'empty' });

const createService = ({
  config = {},
  registered = true,
  scopedRegistered = true,
  claimResults = [],
  runResults = [],
}: {
  config?: Record<string, unknown>;
  registered?: boolean;
  scopedRegistered?: boolean;
  claimResults?: OkResult<SchemaOperationClaimNextResult>[];
  runResults?: OkResult<SchemaOperationRunNextResult>[];
} = {}) => {
  const runner = {
    claimNext: vi.fn(),
    runOperation: vi.fn(),
  };
  for (const result of claimResults) {
    runner.claimNext.mockResolvedValueOnce(result);
  }
  runner.claimNext.mockResolvedValue(idleClaim);

  const scopedRunner = {
    claimNext: vi.fn(),
    runOperation: vi.fn(),
  };
  for (const result of runResults) {
    scopedRunner.runOperation.mockResolvedValueOnce(result);
  }
  scopedRunner.runOperation.mockResolvedValue(okRun({ status: 'idle', reason: 'no_handler' }));

  const createContainer = (
    resolvedRunner: typeof runner,
    isRegistered: boolean
  ): DependencyContainer =>
    ({
      isRegistered: vi.fn(
        (token: symbol) => token === v2CoreTokens.schemaOperationRunnerService && isRegistered
      ),
      resolve: vi.fn((token: symbol) => {
        if (token === v2CoreTokens.schemaOperationRunnerService) {
          return resolvedRunner;
        }
        throw new Error(`Unexpected token: ${String(token)}`);
      }),
    }) as unknown as DependencyContainer;

  const container = createContainer(runner, registered);
  const scopedContainer = createContainer(scopedRunner, scopedRegistered);

  const v2ContainerService = {
    getContainer: vi.fn().mockResolvedValue(container),
    getContainerForBase: vi.fn().mockResolvedValue(scopedContainer),
  } as unknown as V2ContainerService;
  const configService = {
    get: vi.fn((key: string) => config[key]),
  } as unknown as ConfigService;

  return {
    service: new V2SchemaOperationRunnerService(v2ContainerService, configService),
    v2ContainerService,
    container,
    scopedContainer,
    runner,
    scopedRunner,
  };
};

describe('V2SchemaOperationRunnerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(Sentry.withScope).mockClear();
    sentryScope.setContext.mockClear();
    sentryScope.setFingerprint.mockClear();
    sentryScope.setLevel.mockClear();
    sentryScope.setTag.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts on bootstrap and drains runnable schema operations until idle', async () => {
    const failure = domainError.infrastructure({ message: 'repair failed' });
    const { service, runner, scopedRunner, v2ContainerService } = createService({
      claimResults: [
        okClaim({ status: 'claimed', operation: operation('sgoCompleted') }),
        okClaim({ status: 'claimed', operation: operation('sgoFailed') }),
        idleClaim,
      ],
      runResults: [
        okRun({
          status: 'completed',
          operation: operation('sgoCompleted'),
        }),
        okRun({
          status: 'failed',
          operation: operation('sgoFailed'),
          terminal: false,
          retryable: true,
          error: failure,
        }),
      ],
    });

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(runner.claimNext).toHaveBeenCalledTimes(3);
    expect(runner.claimNext.mock.calls[0][0].actorId.toString()).toBe('system');
    expect(runner.claimNext.mock.calls[0][0].requestId).toMatch(/^schema-operation-/);
    expect(runner.claimNext.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        workerId: expect.stringMatching(/^schema-operation-/),
        now: expect.any(Date),
        staleRunningBefore: expect.any(Date),
      })
    );
    // Execution happens on the container scoped to the operation's base.
    expect(v2ContainerService.getContainerForBase).toHaveBeenCalledWith('bseSchemaOpRunner');
    expect(scopedRunner.runOperation).toHaveBeenCalledTimes(2);
    expect(runner.runOperation).not.toHaveBeenCalled();

    service.onModuleDestroy();
  });

  it('captures terminal schema operation failures to Sentry with operation context', async () => {
    const failure = domainError.notImplemented({
      code: 'schema_operation.repair_not_supported',
      message: 'Only missing-column table updates can be repaired automatically',
    });
    const { service } = createService({
      claimResults: [okClaim({ status: 'claimed', operation: operation('sgoTerminal') })],
      runResults: [
        okRun({
          status: 'failed',
          operation: {
            ...operation('sgoTerminal'),
            status: 'dead',
            phase: 'error',
            attempts: 2,
            lastError: 'Only missing-column table updates can be repaired automatically',
          },
          terminal: true,
          retryable: false,
          error: failure,
          originalLastError: 'Unexpected unit of work error: error: too many range table entries',
        }),
      ],
    });

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'V2SchemaOperationFailure',
        message:
          'Only missing-column table updates can be repaired automatically | original: Unexpected unit of work error: error: too many range table entries',
      })
    );
    expect(sentryScope.setTag).toHaveBeenCalledWith('feature', 'v2-schema-operation-runner');
    expect(sentryScope.setTag).toHaveBeenCalledWith('table.id', 'tblSchemaOpRunner');
    expect(sentryScope.setTag).toHaveBeenCalledWith('schema_operation.id', 'sgoTerminal');
    expect(sentryScope.setTag).toHaveBeenCalledWith('schema_operation.created_by', 'system');
    expect(sentryScope.setFingerprint).toHaveBeenCalledWith([
      'v2-schema-operation-runner',
      'table.create',
      'Unexpected unit of work error: error: too many range table entries',
    ]);
    expect(sentryScope.setContext).toHaveBeenCalledWith(
      'schema_operation',
      expect.objectContaining({
        id: 'sgoTerminal',
        createdBy: 'system',
        originalLastError: 'Unexpected unit of work error: error: too many range table entries',
        runnerError: 'Only missing-column table updates can be repaired automatically',
      })
    );

    service.onModuleDestroy();
  });

  it('falls back to the default container when the operation has no base id', async () => {
    const { service, runner, scopedRunner, v2ContainerService } = createService({
      claimResults: [okClaim({ status: 'claimed', operation: operation('sgoNoBase', null) })],
      runResults: [],
    });
    runner.runOperation.mockResolvedValueOnce(
      okRun({ status: 'completed', operation: operation('sgoNoBase', null) })
    );

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(v2ContainerService.getContainerForBase).not.toHaveBeenCalled();
    expect(runner.runOperation).toHaveBeenCalledTimes(1);
    expect(scopedRunner.runOperation).not.toHaveBeenCalled();

    service.onModuleDestroy();
  });

  it('leaves the claimed operation for the stale reclaimer when the scoped container is unavailable', async () => {
    const { service, runner, scopedRunner, v2ContainerService } = createService({
      claimResults: [okClaim({ status: 'claimed', operation: operation('sgoNoContainer') })],
    });
    vi.mocked(v2ContainerService.getContainerForBase).mockRejectedValueOnce(
      new Error('binding lookup failed')
    );

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(scopedRunner.runOperation).not.toHaveBeenCalled();
    expect(runner.runOperation).not.toHaveBeenCalled();
    // The tick keeps draining after the skipped operation.
    expect(runner.claimNext).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
  });

  it('skips execution when the scoped container has no runner registered', async () => {
    const { service, scopedRunner } = createService({
      scopedRegistered: false,
      claimResults: [okClaim({ status: 'claimed', operation: operation('sgoUnregistered') })],
    });

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(scopedRunner.runOperation).not.toHaveBeenCalled();

    service.onModuleDestroy();
  });

  it('does not resolve the v2 container when disabled', async () => {
    const { service, v2ContainerService, runner } = createService({
      config: { V2_SCHEMA_OPERATION_RUNNER_ENABLED: 'false' },
    });

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(v2ContainerService.getContainer).not.toHaveBeenCalled();
    expect(runner.claimNext).not.toHaveBeenCalled();
  });

  it('does not run a scheduled tick after module destroy', async () => {
    const { service, runner } = createService();

    await service.onApplicationBootstrap();
    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(0);

    expect(runner.claimNext).not.toHaveBeenCalled();
  });

  it('reschedules idle checks using the configured poll interval', async () => {
    const { service, runner } = createService({
      config: { V2_SCHEMA_OPERATION_RUNNER_POLL_INTERVAL_MS: '25' },
    });

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.claimNext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24);
    expect(runner.claimNext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(runner.claimNext).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
  });
});
