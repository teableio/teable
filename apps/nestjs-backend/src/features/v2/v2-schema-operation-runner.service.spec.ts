import type { ConfigService } from '@nestjs/config';
import { metrics } from '@opentelemetry/api';
import * as sdkMetrics from '@opentelemetry/sdk-metrics';
import 'reflect-metadata';

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

import type { CrossSpaceLinkConversionRecoveryService } from '../table-lifecycle/cross-space-link-conversion-recovery.service';
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
  baseId: string | null = 'bseSchemaOpRunner',
  type: SchemaOperationRecord['type'] = 'table.create'
): SchemaOperationRecord =>
  ({
    id,
    type,
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
    registerHandler: vi.fn(),
    claimNext: vi.fn(),
    runOperation: vi.fn(),
  };
  for (const result of claimResults) {
    runner.claimNext.mockResolvedValueOnce(result);
  }
  runner.claimNext.mockResolvedValue(idleClaim);

  const scopedRunner = {
    registerHandler: vi.fn(),
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
  const recovery = {
    type: 'host.cross_space_link_conversion',
    run: vi.fn(),
  } as unknown as CrossSpaceLinkConversionRecoveryService;

  return {
    service: new V2SchemaOperationRunnerService(v2ContainerService, configService, recovery),
    v2ContainerService,
    container,
    scopedContainer,
    runner,
    scopedRunner,
    recovery,
  };
};

class CollectingMetricReader extends sdkMetrics.MetricReader {
  private latest: sdkMetrics.CollectionResult | undefined;

  constructor() {
    super({
      aggregationTemporalitySelector: () => sdkMetrics.AggregationTemporality.CUMULATIVE,
    });
  }

  protected async onShutdown(): Promise<void> {
    this.latest = undefined;
  }

  protected async onForceFlush(): Promise<void> {
    this.latest = await this.collect();
  }

  async dataPoints(name: string) {
    await this.forceFlush();
    return (
      this.latest?.resourceMetrics.scopeMetrics
        .flatMap((scope) => scope.metrics)
        .filter((metric) => metric.descriptor.name === name)
        .flatMap((metric) =>
          metric.dataPoints.map(({ attributes, value }) => ({ attributes, value }))
        ) ?? []
    );
  }
}

describe('V2SchemaOperationRunnerService', () => {
  let provider: InstanceType<typeof sdkMetrics.MeterProvider>;
  let reader: CollectingMetricReader;
  beforeEach(() => {
    metrics.disable();
    reader = new CollectingMetricReader();
    provider = new sdkMetrics.MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);
    vi.useFakeTimers();
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(Sentry.withScope).mockClear();
    sentryScope.setContext.mockClear();
    sentryScope.setFingerprint.mockClear();
    sentryScope.setLevel.mockClear();
    sentryScope.setTag.mockClear();
  });

  afterEach(async () => {
    await provider.shutdown();
    metrics.disable();
    vi.useRealTimers();
  });

  it('starts on bootstrap and drains runnable schema operations until idle', async () => {
    const failure = domainError.infrastructure({ message: 'repair failed' });
    const { service, runner, scopedRunner, v2ContainerService, recovery } = createService({
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

    expect(runner.registerHandler).toHaveBeenCalledWith(recovery);
    expect(scopedRunner.registerHandler).toHaveBeenCalledWith(recovery);
    expect(runner.registerHandler.mock.invocationCallOrder[0]).toBeLessThan(
      runner.claimNext.mock.invocationCallOrder[0]
    );
    expect(scopedRunner.registerHandler.mock.invocationCallOrder[0]).toBeLessThan(
      scopedRunner.runOperation.mock.invocationCallOrder[0]
    );
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
  it('exports actor enablement outcomes only after completed or failed runner results', async () => {
    const failure = domainError.infrastructure({ message: 'actor columns failed' });
    const readyOperation = operation(
      'sgoActorReady',
      'bseSchemaOpRunner',
      'table.actor_columns.enable'
    );
    const failedOperation = {
      ...operation('sgoActorFailed', 'bseSchemaOpRunner', 'table.actor_columns.enable'),
      status: 'dead' as const,
      phase: 'error' as const,
    };
    const { service, scopedRunner } = createService({
      claimResults: [
        okClaim({ status: 'claimed', operation: readyOperation }),
        okClaim({ status: 'claimed', operation: failedOperation }),
        idleClaim,
      ],
      runResults: [
        okRun({ status: 'completed', operation: readyOperation }),
        okRun({
          status: 'failed',
          operation: failedOperation,
          terminal: true,
          retryable: false,
          error: failure,
        }),
      ],
    });

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    const points = await reader.dataPoints('teable.schema_operation.outcome');

    expect(scopedRunner.runOperation).toHaveBeenCalledTimes(2);
    expect(points).toEqual(
      expect.arrayContaining([
        {
          attributes: { type: 'table.actor_columns.enable', status: 'ready' },
          value: 1,
        },
        {
          attributes: { type: 'table.actor_columns.enable', status: 'error' },
          value: 1,
        },
      ])
    );
    expect(points).toHaveLength(2);
    expect(Object.keys(points[0].attributes).sort()).toEqual(['status', 'type']);

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

  it('claims a post-cutover actor enable through the replacement metadata container', async () => {
    const fixture = createService({ config: { V2_SCHEMA_OPERATION_RUNNER_POLL_INTERVAL_MS: 25 } });
    await fixture.service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    const enabled = { ...operation('sgoPostCutoverEnable'), type: 'table.actor_columns.enable' };
    const replacementRunner = {
      registerHandler: vi.fn(),
      claimNext: vi
        .fn()
        .mockResolvedValueOnce(okClaim({ status: 'claimed', operation: enabled }))
        .mockResolvedValue(idleClaim),
      runOperation: vi.fn(),
    };
    const replacement = {
      isRegistered: (token: symbol) => token === v2CoreTokens.schemaOperationRunnerService,
      resolve: () => replacementRunner,
    } as unknown as DependencyContainer;
    vi.mocked(fixture.v2ContainerService.getContainer).mockResolvedValue(replacement);
    fixture.runner.claimNext.mockRejectedValue(new Error('Retired metadata pool'));
    fixture.scopedRunner.runOperation.mockResolvedValueOnce(
      okRun({ status: 'completed', operation: enabled })
    );
    await vi.advanceTimersByTimeAsync(25);
    expect(replacementRunner.registerHandler).toHaveBeenCalledWith(fixture.recovery);
    expect(fixture.runner.claimNext).toHaveBeenCalledTimes(1);
    expect(replacementRunner.claimNext).toHaveBeenCalledTimes(2);
    expect(fixture.scopedRunner.runOperation).toHaveBeenCalledWith(
      expect.anything(),
      enabled,
      expect.anything()
    );
    fixture.service.onModuleDestroy();
  });

  it('abandons a claim-container retirement race and resolves fresh handles on the next tick', async () => {
    const fixture = createService({ config: { V2_SCHEMA_OPERATION_RUNNER_POLL_INTERVAL_MS: 25 } });
    fixture.runner.claimNext.mockRejectedValueOnce(new Error('Pool destroyed during claim'));
    await fixture.service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    const replacementRunner = {
      registerHandler: vi.fn(),
      claimNext: vi.fn().mockResolvedValue(idleClaim),
      runOperation: vi.fn(),
    };
    vi.mocked(fixture.v2ContainerService.getContainer).mockResolvedValue({
      isRegistered: () => true,
      resolve: () => replacementRunner,
    } as unknown as DependencyContainer);
    await vi.advanceTimersByTimeAsync(25);
    expect(fixture.runner.claimNext).toHaveBeenCalledTimes(1);
    expect(replacementRunner.claimNext).toHaveBeenCalledTimes(1);
    expect(fixture.scopedRunner.runOperation).not.toHaveBeenCalled();
    fixture.service.onModuleDestroy();
  });
});
