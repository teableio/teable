import 'reflect-metadata';

import type { ConfigService } from '@nestjs/config';
import {
  domainError,
  type SchemaOperationRecord,
  type SchemaOperationRunNextResult,
  v2CoreTokens,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { V2ContainerService } from './v2-container.service';
import { V2SchemaOperationRunnerService } from './v2-schema-operation-runner.service';

const operation = (id: string): SchemaOperationRecord =>
  ({
    id,
    type: 'table.create',
    status: 'running',
    phase: 'running',
    target: { resourceType: 'table', resourceId: 'tblSchemaOpRunner' },
    idempotencyKey: `schema-op:${id}`,
    attempts: 0,
    maxAttempts: 8,
    nextRunAt: new Date('2026-04-28T00:00:00.000Z'),
    createdTime: new Date('2026-04-28T00:00:00.000Z'),
    createdBy: 'system',
  }) as SchemaOperationRecord;

const okResult = (value: SchemaOperationRunNextResult) => ({
  isErr: () => false as const,
  value,
});

const createService = ({
  config = {},
  registered = true,
  results = [okResult({ status: 'idle', reason: 'empty' })],
}: {
  config?: Record<string, unknown>;
  registered?: boolean;
  results?: ReturnType<typeof okResult>[];
} = {}) => {
  const runner = {
    runNext: vi.fn(),
  };
  for (const result of results) {
    runner.runNext.mockResolvedValueOnce(result);
  }
  runner.runNext.mockResolvedValue(okResult({ status: 'idle', reason: 'empty' }));

  const container = {
    isRegistered: vi.fn(
      (token: symbol) => token === v2CoreTokens.schemaOperationRunnerService && registered
    ),
    resolve: vi.fn((token: symbol) => {
      if (token === v2CoreTokens.schemaOperationRunnerService) {
        return runner;
      }
      throw new Error(`Unexpected token: ${String(token)}`);
    }),
  } as unknown as DependencyContainer;

  const v2ContainerService = {
    getContainer: vi.fn().mockResolvedValue(container),
  } as unknown as V2ContainerService;
  const configService = {
    get: vi.fn((key: string) => config[key]),
  } as unknown as ConfigService;

  return {
    service: new V2SchemaOperationRunnerService(v2ContainerService, configService),
    v2ContainerService,
    container,
    runner,
  };
};

describe('V2SchemaOperationRunnerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts on bootstrap and drains runnable schema operations until idle', async () => {
    const failure = domainError.infrastructure({ message: 'repair failed' });
    const { service, runner } = createService({
      results: [
        okResult({
          status: 'completed',
          operation: operation('sgoCompleted'),
        }),
        okResult({
          status: 'failed',
          operation: operation('sgoFailed'),
          terminal: false,
          retryable: true,
          error: failure,
        }),
        okResult({ status: 'idle', reason: 'empty' }),
      ],
    });

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(runner.runNext).toHaveBeenCalledTimes(3);
    expect(runner.runNext.mock.calls[0][0].actorId.toString()).toBe('system');
    expect(runner.runNext.mock.calls[0][0].requestId).toMatch(/^schema-operation-/);
    expect(runner.runNext.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        workerId: expect.stringMatching(/^schema-operation-/),
        now: expect.any(Date),
        staleRunningBefore: expect.any(Date),
      })
    );

    service.onModuleDestroy();
  });

  it('does not resolve the v2 container when disabled', async () => {
    const { service, v2ContainerService, runner } = createService({
      config: { V2_SCHEMA_OPERATION_RUNNER_ENABLED: 'false' },
    });

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(v2ContainerService.getContainer).not.toHaveBeenCalled();
    expect(runner.runNext).not.toHaveBeenCalled();
  });

  it('does not run a scheduled tick after module destroy', async () => {
    const { service, runner } = createService();

    await service.onApplicationBootstrap();
    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(0);

    expect(runner.runNext).not.toHaveBeenCalled();
  });

  it('reschedules idle checks using the configured poll interval', async () => {
    const { service, runner } = createService({
      config: { V2_SCHEMA_OPERATION_RUNNER_POLL_INTERVAL_MS: '25' },
    });

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.runNext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24);
    expect(runner.runNext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(runner.runNext).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
  });
});
