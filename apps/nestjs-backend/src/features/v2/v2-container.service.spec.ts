import 'reflect-metadata';

import { AsyncLocalStorage } from 'node:async_hooks';
import { Writable } from 'node:stream';

import { ConfigService } from '@nestjs/config';
import { DiscoveryService, Reflector } from '@nestjs/core';
import type { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { Test, type TestingModule } from '@nestjs/testing';
import { PgPoolRegistry } from '@teable/db-main-prisma';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import type { IV2NodePgContainerOptions } from '@teable/v2-container-node';
import {
  BackgroundTaskTracker,
  ActorId,
  AsyncMemoryEventBus,
  BaseId,
  EventHandler,
  RecordCreated,
  RecordId,
  TableId,
  v2CoreTokens,
  type IDomainEvent,
  type IEventHandler,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type * as TableQueryOpsModule from '@teable/v2-table-query-ops';
import {
  TableQueryOpsExecutionUnavailableError,
  type TableQueryOpsExecutionResolver,
} from '@teable/v2-table-query-ops';
import { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';
import { ok } from 'neverthrow';
import type { Pool } from 'pg';
import { pinoHttp } from 'pino-http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../attachments/attachments-storage.service', () => ({
  AttachmentsStorageService: class AttachmentsStorageService {},
}));

import { CacheService } from '../../cache/cache.service';
import { thresholdConfig } from '../../configs/threshold.config';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import { DataDbRuntimeCacheService } from '../../global/data-db-runtime-cache.service';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import { TableQueryObservationRuntimeService } from './table-query-observation-runtime.service';
import { V2ContainerService } from './v2-container.service';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';

const fallbackDatabaseUrl = 'postgres://fallback-db';
const createPgPoolRegistry = () =>
  new PgPoolRegistry(
    () =>
      ({
        connect: vi.fn(),
        end: vi.fn().mockResolvedValue(undefined),
        idleCount: 0,
        on: vi.fn(),
        totalCount: 0,
        waitingCount: 0,
      }) as unknown as Pool
  );

const mocks = vi.hoisted(() => ({
  createV2NodePgContainer: vi.fn(),
  disposeV2NodePgContainer: vi.fn(),
  registerV2ShareDbRealtime: vi.fn(),
  registerV2ImportServices: vi.fn(),
  startTableQueryOpsAnalyzerIfEnabled: vi.fn(),
  startTableQueryOpsTaskWorkerIfEnabled: vi.fn(),
  startTableQueryOpsManualSearchTaskWorker: vi.fn(),
}));

vi.mock('@teable/v2-container-node', () => ({
  createV2NodePgContainer: mocks.createV2NodePgContainer,
  disposeV2NodePgContainer: mocks.disposeV2NodePgContainer,
}));

vi.mock('@teable/v2-adapter-realtime-sharedb', () => ({
  ShareDbPubSubPublisher: class ShareDbPubSubPublisher {
    constructor(readonly pubsub: unknown) {}
  },
  ShareDbBackendPresencePublisher: class ShareDbBackendPresencePublisher {
    constructor(readonly backend: unknown) {}
  },
  registerV2ShareDbRealtime: mocks.registerV2ShareDbRealtime,
}));

vi.mock('@teable/v2-import', () => ({
  registerV2ImportServices: mocks.registerV2ImportServices,
}));

vi.mock('@teable/v2-table-query-ops', async () => ({
  TableQueryOpsExecutionUnavailableError: (
    await vi.importActual<typeof TableQueryOpsModule>('@teable/v2-table-query-ops')
  ).TableQueryOpsExecutionUnavailableError,
  executablePhase1RemediationKindValues: [
    'create_search_index',
    'create_search_access_path',
    'rebuild_search_access_path',
    'drop_search_access_path',
    'create_search_vector',
    'rebuild_search_vector',
    'create_filter_index',
    'create_sort_index',
    'repair_index',
    'manual_investigation',
  ],
  NoopTableQueryObservationPublisher: class NoopTableQueryObservationPublisher {},
  startTableQueryOpsAnalyzerIfEnabled: mocks.startTableQueryOpsAnalyzerIfEnabled,
  startTableQueryOpsTaskWorkerIfEnabled: mocks.startTableQueryOpsTaskWorkerIfEnabled,
  startTableQueryOpsManualSearchTaskWorker: mocks.startTableQueryOpsManualSearchTaskWorker,
}));

vi.mock('@teable/v2-adapter-undo-redo-keyv', () => ({
  KeyvUndoRedoStore: class KeyvUndoRedoStore {
    constructor(
      readonly keyv: unknown,
      readonly options: unknown
    ) {}
  },
}));

vi.mock('../../share-db/share-db.service', () => ({
  ShareDbService: class ShareDbService {},
}));

vi.mock('../../cache/cache.service', () => ({
  CacheService: class CacheService {},
}));

vi.mock('./v2-query-bus-tracing.middleware', () => ({
  QueryBusTracingMiddleware: class QueryBusTracingMiddleware {},
}));

vi.mock('./v2-logger.adapter', () => ({
  PinoLoggerAdapter: class PinoLoggerAdapter {
    constructor(readonly logger: unknown) {}
  },
}));

vi.mock('./v2-tracer.adapter', () => ({
  OpenTelemetryTracer: class OpenTelemetryTracer {},
}));

@V2ProjectionRegistrar()
class TestProjectionRegistrar implements IV2ProjectionRegistrar {
  registerProjections = vi.fn();
}

const createGate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const createProviderWrapper = (instance: object, staticTree = true): InstanceWrapper<object> =>
  ({
    instance,
    metatype: instance.constructor,
    inject: undefined,
    token: instance.constructor,
    name: instance.constructor.name,
    isDependencyTreeStatic: () => staticTree,
  }) as InstanceWrapper<object>;

const createContainerMock = (
  eventBus = new AsyncMemoryEventBus({
    resolve: () => {
      throw new Error('Unexpected event handler');
    },
  })
): DependencyContainer => {
  const db = { destroy: vi.fn() };
  return {
    isRegistered: vi.fn(),
    registerInstance: vi.fn(),
    resolve: vi.fn((token: symbol) => {
      if (token === v2CoreTokens.eventBus) {
        return eventBus;
      }
      if (token === v2MetaDbTokens.db || token === v2DataDbTokens.db) {
        return db;
      }
      if (token === v2CoreTokens.attachmentLookupService) {
        return {};
      }
      if (token === v2CoreTokens.attachmentValueDecoratorService) {
        return {};
      }
      if (token === v2CoreTokens.tracer) {
        return {};
      }
      if (token === v2CoreTokens.undoRedoStore) {
        return undefined;
      }
      if (token === v2CoreTokens.tracer) {
        return undefined;
      }
      throw new Error(`Unexpected token: ${String(token)}`);
    }),
  } as unknown as DependencyContainer;
};

const createPinoLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const createService = (providers: InstanceWrapper[] = [], pinoLogger?: PinoLogger) => {
  const pinoLoggerMock = createPinoLogger();
  const configService = {
    getOrThrow: vi.fn().mockReturnValue('postgres://test'),
    get: vi.fn().mockReturnValue(undefined),
  };
  const shareDbService = {
    pubsub: { publish: vi.fn() },
  };
  const cacheService = { getKeyv: vi.fn().mockReturnValue({}) };
  const attachmentsStorageService = {
    getPreviewUrlByPath: vi.fn(),
    getTableThumbnailUrl: vi.fn(),
  };
  const dataDbClientManager = {
    getDataDatabaseForSpace: vi.fn(),
    getDataDatabaseForBase: vi.fn(),
    getDataDatabaseForTable: vi.fn(),
    getDataDatabaseForTablePreviewReadOnly: vi.fn(),
  };
  const runtimeCache = new DataDbRuntimeCacheService();
  const pgPoolRegistry = createPgPoolRegistry();
  const tableQueryObservationRuntime = {
    dispose: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue({ db: {}, publisher: {} }),
  };
  const reflector = new Reflector();
  const discoveryService = {
    getProviders: vi.fn().mockReturnValue(providers),
  } as unknown as DiscoveryService;

  const service = new V2ContainerService(
    configService as never,
    pinoLogger ?? (pinoLoggerMock as unknown as PinoLogger),
    shareDbService as never,
    cacheService as never,
    attachmentsStorageService as never,
    { undoExpirationTime: 60, maxUndoStackSize: 20 } as never,
    reflector,
    discoveryService,
    {
      get: vi.fn().mockImplementation(() => {
        throw new Error('COMPUTED_OUTBOX_ADMIN not registered');
      }),
    } as never,
    dataDbClientManager as never,
    runtimeCache,
    pgPoolRegistry,
    tableQueryObservationRuntime as never,
    new ClsService<IClsStore>(new AsyncLocalStorage())
  );

  return {
    service,
    configService,
    shareDbService,
    cacheService,
    attachmentsStorageService,
    dataDbClientManager,
    runtimeCache,
    pgPoolRegistry,
    tableQueryObservationRuntime,
    discoveryService,
    pinoLogger: pinoLoggerMock,
  };
};

const createTestingModule = async (providers: InstanceWrapper[] = []) => {
  const configService = {
    getOrThrow: vi.fn().mockReturnValue('postgres://test'),
    get: vi.fn().mockReturnValue(undefined),
  };
  const shareDbService = {
    pubsub: { publish: vi.fn() },
  };
  const cacheService = { getKeyv: vi.fn().mockReturnValue({}) };
  const attachmentsStorageService = {
    getPreviewUrlByPath: vi.fn(),
    getTableThumbnailUrl: vi.fn(),
  };
  const dataDbClientManager = {
    getDataDatabaseForSpace: vi.fn(),
    getDataDatabaseForBase: vi.fn(),
    getDataDatabaseForTable: vi.fn(),
    getDataDatabaseForTablePreviewReadOnly: vi.fn(),
  };
  const runtimeCache = new DataDbRuntimeCacheService();
  const pgPoolRegistry = createPgPoolRegistry();
  const tableQueryObservationRuntime = {
    dispose: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue({ db: {}, publisher: {} }),
  };
  const reflector = new Reflector();
  const discoveryService = {
    getProviders: vi.fn().mockReturnValue(providers),
  } as unknown as DiscoveryService;

  const module = await Test.createTestingModule({
    providers: [
      V2ContainerService,
      { provide: ClsService, useValue: new ClsService<IClsStore>(new AsyncLocalStorage()) },
      { provide: ConfigService, useValue: configService },
      { provide: PinoLogger, useValue: {} },
      { provide: ShareDbService, useValue: shareDbService },
      { provide: CacheService, useValue: cacheService },
      { provide: AttachmentsStorageService, useValue: attachmentsStorageService },
      { provide: DataDbClientManager, useValue: dataDbClientManager },
      { provide: DataDbRuntimeCacheService, useValue: runtimeCache },
      { provide: PgPoolRegistry, useValue: pgPoolRegistry },
      {
        provide: TableQueryObservationRuntimeService,
        useValue: tableQueryObservationRuntime,
      },
      {
        provide: thresholdConfig.KEY,
        useValue: { undoExpirationTime: 60, maxUndoStackSize: 20 },
      },
      { provide: Reflector, useValue: reflector },
      { provide: DiscoveryService, useValue: discoveryService },
    ],
  }).compile();

  return {
    module,
    configService,
    shareDbService,
    cacheService,
    attachmentsStorageService,
    discoveryService,
  };
};

describe('V2ContainerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('routes workers to a cached isolated maintenance container and disposes it', async () => {
    const requestContainer = createContainerMock();
    const maintenanceContainer = createContainerMock();
    mocks.createV2NodePgContainer
      .mockResolvedValueOnce(requestContainer)
      .mockResolvedValueOnce(maintenanceContainer);
    const { service, configService, dataDbClientManager } = createService();
    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_MAINTENANCE_STATEMENT_DEADLINE_MS') return '120000';
      return undefined;
    });
    dataDbClientManager.getDataDatabaseForTable.mockResolvedValue({
      cacheKey: 'isolated-route',
      url: 'postgres://data-db',
    });

    await service.getContainer();
    const resolveExecution = mocks.startTableQueryOpsTaskWorkerIfEnabled.mock
      .calls[0][2] as TableQueryOpsExecutionResolver;
    expect((await resolveExecution('tblRoutingTarget')).container).toBe(maintenanceContainer);
    expect((await resolveExecution('tblRoutingTarget')).container).toBe(maintenanceContainer);
    expect(() => service.getComputedWriter(maintenanceContainer)).toThrow(
      'Computed writer has no active data pool'
    );
    expect(mocks.createV2NodePgContainer).toHaveBeenCalledTimes(2);
    expect(mocks.createV2NodePgContainer.mock.calls[1][0]).toMatchObject({
      ensureSchema: false,
      dataConnectionString: 'postgres://data-db',
      metaDbDependencies: { maintenanceStatementDeadlineMs: 120_000 },
      dataDbDependencies: { maintenanceStatementDeadlineMs: 120_000 },
      schemaCoordination: false,
    });
    expect(mocks.startTableQueryOpsTaskWorkerIfEnabled).toHaveBeenCalledTimes(1);

    await service.onModuleDestroy();
    expect(mocks.disposeV2NodePgContainer).toHaveBeenCalledWith(maintenanceContainer);
  });

  it.each([
    [
      'refused connection',
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    ],
    ['lost connection', Object.assign(new Error('connection failure'), { code: '08006' })],
    [
      'database rejecting connections',
      Object.assign(new Error('database "pr4559_data" is not currently accepting connections'), {
        code: '55000',
      }),
    ],
    [
      'startup refusal',
      Object.assign(new Error('the database system is starting up'), { code: '57P03' }),
    ],
    ['connection timeout', Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })],
    [
      'maintenance statement deadline',
      Object.assign(new Error('maintenance statement deadline'), {
        code: 'TABLE_QUERY_OPS_STATEMENT_TIMEOUT',
      }),
    ],
    ['exhausted pool', Object.assign(new Error('pool exhausted'), { code: 'P2024' })],
    [
      'wrapped connection failure',
      new Error('Failed to initialize database', {
        cause: Object.assign(new Error('connection failure'), { code: '08006' }),
      }),
    ],
  ] as const)(
    'defers maintenance routing for a %s with the original cause',
    async (_label, failure) => {
      mocks.createV2NodePgContainer.mockResolvedValue(createContainerMock());
      const { service, configService, dataDbClientManager } = createService();
      configService.get.mockImplementation((key: string) =>
        key === 'V2_TABLE_QUERY_OPS_ENABLED' ? 'true' : undefined
      );
      await service.getContainer();
      dataDbClientManager.getDataDatabaseForTable.mockRejectedValue(failure);
      const resolveExecution = mocks.startTableQueryOpsTaskWorkerIfEnabled.mock
        .calls[0][2] as TableQueryOpsExecutionResolver;
      const rejected = await resolveExecution('tblRoutingTarget').catch((error: unknown) => error);
      expect(rejected).toBeInstanceOf(TableQueryOpsExecutionUnavailableError);
      if (!(rejected instanceof TableQueryOpsExecutionUnavailableError)) throw rejected;
      expect(rejected.cause).toBe(failure);
      expect(rejected).toMatchObject({ message: failure.message, cause: failure });
    }
  );

  it.each([
    [
      'authentication failure',
      Object.assign(new Error('password authentication failed'), { code: '28P01' }),
    ],
    [
      'deleted database',
      Object.assign(new Error('database "removed" does not exist'), { code: '3D000' }),
    ],
    [
      'missing table',
      Object.assign(new Error('relation "missing" does not exist'), { code: '42P01' }),
    ],
    [
      'missing schema',
      Object.assign(new Error('schema "missing" does not exist'), { code: '3F000' }),
    ],
    [
      'deleted pooler tenant',
      Object.assign(new Error('Tenant or user not found'), { code: 'ENOTFOUND' }),
    ],
    [
      'statement timeout',
      Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }),
    ],
    ['retryable SQL failure', Object.assign(new Error('deadlock detected'), { code: '40P01' })],
    [
      'other object state',
      Object.assign(new Error('object is not in prerequisite state'), { code: '55000' }),
    ],
    [
      'untyped unavailable message',
      new Error('database "pr4559_data" is not currently accepting connections'),
    ],
    ['missing configuration', new Error('Data database connection has no encrypted URL')],
    ['unknown failure', new Error('unrecognized routing failure')],
    [
      'wrapped permanent failure',
      new Error('Failed to initialize database', {
        cause: Object.assign(new Error('password authentication failed'), { code: '28P01' }),
      }),
    ],
  ] as const)('keeps a %s as a bounded routing failure', async (_label, failure) => {
    mocks.createV2NodePgContainer.mockResolvedValue(createContainerMock());
    const { service, configService, dataDbClientManager } = createService();
    configService.get.mockImplementation((key: string) =>
      key === 'V2_TABLE_QUERY_OPS_ENABLED' ? 'true' : undefined
    );
    await service.getContainer();
    dataDbClientManager.getDataDatabaseForTable.mockRejectedValue(failure);
    const resolveExecution = mocks.startTableQueryOpsTaskWorkerIfEnabled.mock
      .calls[0][2] as TableQueryOpsExecutionResolver;
    await expect(resolveExecution('tblRoutingTarget')).rejects.toBe(failure);
  });

  it('discovers projection registrars and initializes the shared container during bootstrap', async () => {
    const registrar = new TestProjectionRegistrar();
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, discoveryService } = createService([createProviderWrapper(registrar)]);

    await service.onApplicationBootstrap();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledTimes(1);
    expect(mocks.registerV2ShareDbRealtime).toHaveBeenCalledTimes(1);
    expect(mocks.registerV2ShareDbRealtime).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        computeActivitySignal: {
          resolveChannel: expect.any(Function),
          actionKey: 'computeActivityChanged',
        },
      })
    );
    expect(mocks.registerV2ImportServices).toHaveBeenCalledTimes(1);
    expect(container.registerInstance).toHaveBeenCalledWith(
      v2CoreTokens.recordChangedValueDecoratorService,
      expect.any(Object)
    );
    expect(discoveryService.getProviders).toHaveBeenCalledTimes(1);
    expect(registrar.registerProjections).toHaveBeenCalledTimes(1);
    expect(registrar.registerProjections).toHaveBeenCalledWith(container);
  });

  it('reuses the same initialization promise and retries after a failed startup attempt', async () => {
    const registrar = new TestProjectionRegistrar();
    const container = createContainerMock();
    const { service } = createService([createProviderWrapper(registrar)]);

    mocks.createV2NodePgContainer.mockRejectedValueOnce(new Error('boom'));
    await expect(service.getContainer()).rejects.toThrow('boom');

    mocks.createV2NodePgContainer.mockResolvedValueOnce(container);
    await expect(service.getContainer()).resolves.toBe(container);
    await expect(service.getContainer()).resolves.toBe(container);

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledTimes(2);
    expect(registrar.registerProjections).toHaveBeenCalledTimes(1);
  });

  it('uses the meta database as the default data database without a global data env', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();

    configService.get.mockImplementation((key: string) => {
      if (key === 'PRISMA_META_DATABASE_URL') {
        return 'postgres://meta-db';
      }
      return undefined;
    });

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        metaConnectionString: 'postgres://meta-db',
        dataConnectionString: 'postgres://meta-db',
      })
    );
  });

  it('fails BYODB coordination acquires fast by default', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService, dataDbClientManager } = createService();
    configService.get.mockImplementation((key: string) => {
      if (key === 'PRISMA_META_DATABASE_URL') return 'postgres://meta-db';
      return undefined;
    });
    dataDbClientManager.getDataDatabaseForSpace.mockResolvedValue({
      cacheKey: 'spc-byodb',
      url: 'postgres://data-db',
      internalSchema: 'teable_meta_x',
      isMetaFallback: false,
    });

    await service.getContainerForSpace('spc1');

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaCoordination: { maxConnections: 32, connectionTimeoutMillis: 2000 },
      })
    );
  });

  it('sizes BYODB pools and coordination from the connection budget', async () => {
    vi.stubEnv('BYODB_DATA_DB_PG_MAX_CONNECTIONS', '100');
    vi.stubEnv('BYODB_DATA_DB_DATABASES_PER_SERVER', '20');
    vi.stubEnv('BYODB_APP_NODES', '1');
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService, dataDbClientManager, pgPoolRegistry } = createService();
    configService.get.mockImplementation((key: string) => {
      if (key === 'PRISMA_META_DATABASE_URL') return 'postgres://meta-db';
      if (key === 'V2_SCHEMA_COORDINATION_MAX_CONNECTIONS') return '3';
      if (key === 'V2_SCHEMA_COORDINATION_CONNECTION_TIMEOUT_MS') return '2500';
      return undefined;
    });
    dataDbClientManager.getDataDatabaseForSpace.mockResolvedValue({
      cacheKey: 'spc-byodb',
      url: 'postgres://data-db',
      internalSchema: 'teable_meta_x',
      isMetaFallback: false,
    });

    await service.getContainerForSpace('spc1');

    expect(pgPoolRegistry.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ host: 'meta-db', max: 20 }),
        // 80 / (1 pod × 20 databases) = 4 minus two auxiliary connections.
        expect.objectContaining({ host: 'data-db', max: 2 }),
      ])
    );
    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaCoordination: { maxConnections: 3, connectionTimeoutMillis: 2500 },
      })
    );
  });

  it('publishes outbox wakeups without configuring a polling worker', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service } = createService();

    await service.getContainer();

    expect(mocks.createV2NodePgContainer.mock.calls[0]?.[0].computedUpdate).toEqual(
      expect.objectContaining({
        wakeupPublisher: expect.objectContaining({ publish: expect.any(Function) }),
      })
    );
    expect(mocks.createV2NodePgContainer.mock.calls[0]?.[0].computedUpdate).not.toHaveProperty(
      'pollingConfig'
    );
    expect(
      mocks.createV2NodePgContainer.mock.calls[0]?.[0].computedUpdate?.fieldBackfillConfig
    ).toBeUndefined();
  });

  it('passes computed task timeout and field-backfill batch config to the v2 container', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();
    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_COMPUTED_OUTBOX_TASK_STATEMENT_TIMEOUT_MS') return 90_000;
      if (key === 'V2_COMPUTED_INLINE_STATEMENT_TIMEOUT_MS') return 15_000;
      if (key === 'V2_COMPUTED_OUTBOX_FIELD_BACKFILL_BATCH_SIZE') return 250;
      return undefined;
    });

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        computedUpdate: expect.objectContaining({
          outboxConfig: {
            taskStatementTimeoutMs: 90_000,
            fieldBackfillBatchSize: 250,
            continuationRelayClaimEnabled: true,
          },
          runtimeConfig: {
            inlineStatementTimeoutMs: 15_000,
          },
        }),
      })
    );
  });

  it('disables continuation relay claim through the env kill switch', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();
    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_COMPUTED_OUTBOX_CONTINUATION_RELAY_CLAIM_ENABLED') return false;
      return undefined;
    });

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        computedUpdate: expect.objectContaining({
          outboxConfig: expect.objectContaining({ continuationRelayClaimEnabled: false }),
        }),
      })
    );
  });

  it('publishes transaction-sized synchronous backfills without configuring polling', async () => {
    vi.stubEnv('V2_COMPUTED_UPDATE_MODE', 'sync');
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service } = createService();

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        computedUpdate: expect.objectContaining({
          mode: 'sync',
          fieldBackfillConfig: { mode: 'sync' },
          wakeupPublisher: expect.objectContaining({ publish: expect.any(Function) }),
        }),
      })
    );
    expect(mocks.createV2NodePgContainer.mock.calls[0]?.[0].computedUpdate).not.toHaveProperty(
      'pollingConfig'
    );
  });

  it('parses string row-limit config before creating the shared container', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();

    configService.get.mockImplementation((key: string) => {
      if (key === 'MAX_FREE_ROW_LIMIT') {
        return '10';
      }
      return undefined;
    });

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        maxFreeRowLimit: 10,
      })
    );
  });

  it('prefers system row-limit config over the legacy free-row alias', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();

    configService.get.mockImplementation((key: string) => {
      if (key === 'TABLE_LIMIT_RECORDS_PER_TABLE_MAX') {
        return '8';
      }
      if (key === 'MAX_FREE_ROW_LIMIT') {
        return '10';
      }
      return undefined;
    });

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        tableMaxRowLimit: 8,
      })
    );
  });

  it('registers table query ops when the feature flag is enabled', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();

    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'true';
      return undefined;
    });

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        tableQueryOps: expect.objectContaining({
          ensureSchema: true,
          observationDb: expect.anything(),
          observationPublisher: expect.anything(),
          observationReader: expect.anything(),
          observationSink: expect.anything(),
        }),
      })
    );
  });

  it('keeps table query ops isolated on stable runtime ports while runtime retries', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService, tableQueryObservationRuntime } = createService();
    configService.get.mockImplementation((key: string) =>
      key === 'V2_TABLE_QUERY_OPS_ENABLED' ? 'true' : undefined
    );
    tableQueryObservationRuntime.get.mockResolvedValue(undefined);

    await service.getContainer();

    const tableQueryOps = mocks.createV2NodePgContainer.mock.calls[0]?.[0].tableQueryOps;
    expect(tableQueryOps).toMatchObject({
      ensureObservationSchema: false,
      observationDisabled: true,
      observationPublisher: tableQueryObservationRuntime,
      observationReader: tableQueryObservationRuntime,
      observationSink: tableQueryObservationRuntime,
    });
    expect(tableQueryOps).not.toHaveProperty('observationDb');
  });

  it('runs search access path maintenance alone when the full feature stays off', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService, tableQueryObservationRuntime } = createService();

    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_SEARCH_MAINTENANCE_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_TASK_WORKER_ENABLED') return 'false';
      if (key === 'V2_TABLE_QUERY_OPS_AUTO_ACCEPT') return 'auto';
      if (key === 'V2_TABLE_QUERY_OPS_ANALYZER_ENABLED') return 'true';
      return undefined;
    });

    await service.getContainer();

    expect(tableQueryObservationRuntime.get).not.toHaveBeenCalled();
    const tableQueryOps = mocks.createV2NodePgContainer.mock.calls[0]?.[0].tableQueryOps;
    expect(tableQueryOps).toMatchObject({
      observationDisabled: true,
      skipRecordQueryObservation: true,
      decisionPolicyConfig: { autoAcceptMode: 'off' },
      analyzerConfig: expect.objectContaining({ enabled: false }),
      taskWorkerConfig: expect.objectContaining({
        enabled: true,
        scope: 'search_maintenance',
        allowManualIndexExecution: false,
        allowPolicyIndexExecution: false,
        allowedKinds: [
          'create_search_access_path',
          'rebuild_search_access_path',
          'drop_search_access_path',
        ],
      }),
    });
    expect(tableQueryOps).not.toHaveProperty('observationDb');
    expect(tableQueryOps).not.toHaveProperty('observationPublisher');
  });

  it('keeps the full feature behavior when both table query ops switches are enabled', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();

    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_SEARCH_MAINTENANCE_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_AUTO_ACCEPT') return 'auto';
      return undefined;
    });

    await service.getContainer();

    const tableQueryOps = mocks.createV2NodePgContainer.mock.calls[0]?.[0].tableQueryOps;
    expect(tableQueryOps).toMatchObject({
      decisionPolicyConfig: { autoAcceptMode: 'auto' },
      taskWorkerConfig: expect.objectContaining({
        enabled: true,
        allowPolicyIndexExecution: true,
      }),
    });
    expect(tableQueryOps?.taskWorkerConfig).not.toHaveProperty('scope');
  });

  it('enables the task worker and index execution when auto acceptance is enabled', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();

    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_AUTO_ACCEPT') return 'auto';
      return undefined;
    });

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        tableQueryOps: expect.objectContaining({
          decisionPolicyConfig: { autoAcceptMode: 'auto' },
          taskWorkerConfig: expect.objectContaining({
            enabled: true,
            allowManualIndexExecution: false,
            allowPolicyIndexExecution: true,
            allowedKinds: [
              'create_search_index',
              'create_search_access_path',
              'rebuild_search_access_path',
              'drop_search_access_path',
              'create_search_vector',
              'rebuild_search_vector',
              'create_filter_index',
              'create_sort_index',
              'repair_index',
              'manual_investigation',
            ],
          }),
        }),
      })
    );
  });

  it('starts internal search-vector maintenance when generated search runtime is enabled', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();

    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_SEARCH_VECTOR_RUNTIME') return 'auto';
      return undefined;
    });

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        tableQueryOps: expect.objectContaining({
          taskWorkerConfig: expect.objectContaining({
            enabled: true,
            allowManualIndexExecution: false,
            allowPolicyIndexExecution: false,
            // rebuild_search_access_path is what schema-change maintenance
            // enqueues; the worker must claim it or search silently degrades
            // to ILIKE after any field change. drop_search_access_path is
            // enqueued by the reclaim sweep under the same runtime.
            allowedKinds: [
              'rebuild_search_access_path',
              'rebuild_search_vector',
              'drop_search_access_path',
              'manual_investigation',
            ],
          }),
        }),
      })
    );
  });

  it('preserves an explicit remediation allowlist when search runtime is enabled', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();

    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_SEARCH_VECTOR_RUNTIME') return 'auto';
      if (key === 'V2_TABLE_QUERY_OPS_ALLOWED_TASK_KINDS') return 'manual_investigation';
      return undefined;
    });

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        tableQueryOps: expect.objectContaining({
          taskWorkerConfig: expect.objectContaining({
            allowedKinds: ['manual_investigation'],
          }),
        }),
      })
    );
  });
  it('does not enable table query ops without an environment flag', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, tableQueryObservationRuntime } = createService();

    await service.getContainer();

    expect(service.isTableQuerySearchVectorRuntimeEnabled()).toBe(false);
    expect(tableQueryObservationRuntime.get).not.toHaveBeenCalled();
    expect(mocks.startTableQueryOpsAnalyzerIfEnabled).not.toHaveBeenCalled();
    expect(mocks.startTableQueryOpsTaskWorkerIfEnabled).not.toHaveBeenCalled();
    expect(mocks.startTableQueryOpsManualSearchTaskWorker).not.toHaveBeenCalled();
  });

  it.each([
    'V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME',
    'V2_TABLE_QUERY_OPS_SEARCH_VECTOR_RUNTIME',
  ])(
    'reports standalone search via %s without starting observation or workers',
    async (runtimeKey) => {
      mocks.createV2NodePgContainer.mockResolvedValue(createContainerMock());
      const { service, configService, tableQueryObservationRuntime } = createService();
      configService.get.mockImplementation((key: string) => {
        if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'false';
        if (key === runtimeKey) return 'auto';
        // Standalone reads must not activate explicitly configured management work.
        if (key === 'V2_TABLE_QUERY_OPS_ANALYZER_ENABLED') return 'true';
        if (key === 'V2_TABLE_QUERY_OPS_AUTO_ACCEPT') return 'auto';
        return undefined;
      });

      await service.getContainer();

      expect(service.isTableQuerySearchVectorRuntimeEnabled()).toBe(true);
      expect(tableQueryObservationRuntime.get).not.toHaveBeenCalled();
      expect(mocks.startTableQueryOpsAnalyzerIfEnabled).not.toHaveBeenCalled();
      expect(mocks.startTableQueryOpsTaskWorkerIfEnabled).not.toHaveBeenCalled();
      expect(mocks.startTableQueryOpsManualSearchTaskWorker).not.toHaveBeenCalled();
    }
  );

  it('honors explicit search runtime off over the legacy auto alias', () => {
    const { service, configService } = createService();
    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'false';
      if (key === 'V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME') return 'off';
      if (key === 'V2_TABLE_QUERY_OPS_SEARCH_VECTOR_RUNTIME') return 'auto';
      return undefined;
    });

    expect(service.isTableQuerySearchVectorRuntimeEnabled()).toBe(false);
  });

  it('keeps automatic workers off while configuring the dedicated manual search runner', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();
    configService.get.mockImplementation((key: string) =>
      key === 'V2_TABLE_QUERY_OPS_ENABLED' ? 'true' : undefined
    );

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        tableQueryOps: expect.objectContaining({
          ensureSchema: true,
          analyzerConfig: expect.objectContaining({
            enabled: false,
            intervalMs: 5 * 60 * 1000,
          }),
          taskWorkerConfig: expect.objectContaining({
            enabled: false,
            allowManualIndexExecution: false,
            allowPolicyIndexExecution: false,
          }),
        }),
      })
    );
    expect(service.isSearchAccessPathManualExecutionEnabled()).toBe(true);
    expect(mocks.startTableQueryOpsManualSearchTaskWorker).toHaveBeenCalledExactlyOnceWith(
      container,
      expect.anything(),
      expect.any(Function)
    );
  });

  it.each([undefined, 'false', 'true'])(
    'reports manual execution from management enablement (%s), not automatic worker flags',
    (enabled) => {
      const { service, configService } = createService();
      configService.get.mockImplementation((key: string) => {
        if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return enabled;
        if (key === 'V2_TABLE_QUERY_OPS_TASK_WORKER_ENABLED') return 'false';
        if (key === 'V2_TABLE_QUERY_OPS_ANALYZER_ENABLED') return 'false';
        if (key === 'V2_TABLE_QUERY_OPS_AUTO_ACCEPT') return 'off';
        return undefined;
      });
      expect(service.isSearchAccessPathManualExecutionEnabled()).toBe(enabled === 'true');
    }
  );

  it('starts manual recovery at bootstrap, routes by table, and stops it on shutdown', async () => {
    const container = createContainerMock();
    const target = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValueOnce(container).mockResolvedValueOnce(target);
    const stop = vi.fn();
    mocks.startTableQueryOpsManualSearchTaskWorker.mockReturnValueOnce({ stop });
    const { service, configService, dataDbClientManager } = createService();
    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_TASK_WORKER_ENABLED') return 'false';
      if (key === 'V2_TABLE_QUERY_OPS_ANALYZER_ENABLED') return 'false';
      if (key === 'V2_TABLE_QUERY_OPS_AUTO_ACCEPT') return 'off';
      return undefined;
    });
    dataDbClientManager.getDataDatabaseForTable.mockResolvedValue({
      cacheKey: 'manual-search-target',
      url: 'postgres://manual-search-target',
    });

    await service.onApplicationBootstrap();
    expect(mocks.startTableQueryOpsManualSearchTaskWorker).toHaveBeenCalledOnce();
    const resolveExecution = mocks.startTableQueryOpsManualSearchTaskWorker.mock.calls[0][2];
    const execution = await resolveExecution('tblManualSearchTarget');
    expect(dataDbClientManager.getDataDatabaseForTable).toHaveBeenCalledExactlyOnceWith(
      'tblManualSearchTarget'
    );
    expect(execution.container).toBe(target);
    expect(execution.context.actorId.toString()).toBe('system');
    expect(execution.context.requestId).toBe('v2-table-query-ops:nest');

    await service.onModuleDestroy();
    expect(stop).toHaveBeenCalledOnce();
    expect(mocks.disposeV2NodePgContainer).toHaveBeenCalledWith(container);
    expect(mocks.disposeV2NodePgContainer).toHaveBeenCalledWith(target);
  });

  it('scopes table query ops worker ids to HOSTNAME so container pid 1 does not share leases', async () => {
    vi.stubEnv('HOSTNAME', 'teable-prod-d77466d8b-qhtcf');
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();
    configService.get.mockImplementation((key: string) =>
      key === 'V2_TABLE_QUERY_OPS_ENABLED' ? 'true' : undefined
    );

    try {
      await service.getContainer();

      expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          tableQueryOps: expect.objectContaining({
            analyzerConfig: expect.objectContaining({
              workerId: 'nestjs-teable-prod-d77466d8b-qhtcf:analyzer',
            }),
            taskWorkerConfig: expect.objectContaining({
              workerId: 'nestjs-teable-prod-d77466d8b-qhtcf:task-worker',
            }),
          }),
        })
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('allows the analyzer default to be enabled when table query ops is on', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();
    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_ANALYZER_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_ANALYZER_INTERVAL_MS') return '120000';
      return undefined;
    });

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        tableQueryOps: expect.objectContaining({
          analyzerConfig: expect.objectContaining({
            enabled: true,
            intervalMs: 120_000,
          }),
          taskWorkerConfig: expect.objectContaining({
            enabled: false,
          }),
        }),
      })
    );
  });

  it('keeps an explicit false flag as the table query ops kill switch', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();
    configService.get.mockImplementation((key: string) =>
      key === 'V2_TABLE_QUERY_OPS_ENABLED' ? 'false' : undefined
    );

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.not.objectContaining({ tableQueryOps: expect.anything() })
    );
  });

  it('creates a scoped container from the base data database binding', async () => {
    const defaultContainer = createContainerMock();
    const scopedContainer = createContainerMock();
    mocks.createV2NodePgContainer
      .mockResolvedValueOnce(defaultContainer)
      .mockResolvedValueOnce(scopedContainer);
    const { service, configService, dataDbClientManager } = createService();

    configService.get.mockImplementation((key: string) =>
      key === 'PRISMA_META_DATABASE_URL' ? 'postgres://meta-db' : undefined
    );
    dataDbClientManager.getDataDatabaseForBase.mockResolvedValue({
      cacheKey: 'dcnxxx',
      url: 'postgres://space-data-db',
      isMetaFallback: false,
      connectionId: 'dcnxxx',
    });

    await expect(service.getContainer()).resolves.toBe(defaultContainer);
    await expect(service.getContainerForBase('bsexxx')).resolves.toBe(scopedContainer);
    await expect(service.getContainerForBase('bsexxx')).resolves.toBe(scopedContainer);

    expect(dataDbClientManager.getDataDatabaseForBase).toHaveBeenCalledWith('bsexxx');
    expect(mocks.createV2NodePgContainer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        metaConnectionString: 'postgres://meta-db',
        dataConnectionString: 'postgres://space-data-db',
      })
    );
    expect(mocks.createV2NodePgContainer).toHaveBeenCalledTimes(2);
    const defaultOptions = mocks.createV2NodePgContainer.mock
      .calls[0]![0] as IV2NodePgContainerOptions;
    const scopedOptions = mocks.createV2NodePgContainer.mock
      .calls[1]![0] as IV2NodePgContainerOptions;
    expect(scopedOptions.metaDbDependencies?.pool).toBe(defaultOptions.metaDbDependencies?.pool);
    expect(scopedOptions.dataDbDependencies?.pool).not.toBe(
      defaultOptions.metaDbDependencies?.pool
    );
  });

  it('reuses the bootstrapped container for the meta-fallback route', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, dataDbClientManager } = createService();
    dataDbClientManager.getDataDatabaseForSpace.mockResolvedValue({
      cacheKey: 'meta-fallback',
      url: fallbackDatabaseUrl,
      connectionUrl: fallbackDatabaseUrl,
      isMetaFallback: true,
    });

    await expect(service.getContainer()).resolves.toBe(container);
    await expect(service.getContainerForSpace('spcxxx')).resolves.toBe(container);

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledOnce();
  });

  it('reacquires cold metadata for preview without normal initialization or worker promotion', async () => {
    const warmContainer = createContainerMock();
    const coldContainer = createContainerMock();
    mocks.createV2NodePgContainer
      .mockResolvedValueOnce(warmContainer)
      .mockResolvedValueOnce(coldContainer);
    const { service, configService, runtimeCache, tableQueryObservationRuntime } = createService();
    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_ANALYZER_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_AUTO_ACCEPT') return 'auto';
      return undefined;
    });
    const normalAcquisition = vi.spyOn(service, 'getContainer').mockImplementation(() => {
      throw new Error('Normal metadata acquisition is forbidden during preview');
    });

    await expect(service.getPreviewContainer()).resolves.toBe(warmContainer);
    await runtimeCache.deleteByKey('meta-fallback');
    await expect(service.getPreviewContainer()).resolves.toBe(coldContainer);
    await expect(service.getPreviewContainer()).resolves.toBe(coldContainer);

    expect(normalAcquisition).not.toHaveBeenCalled();
    expect(mocks.createV2NodePgContainer).toHaveBeenCalledTimes(2);
    for (const [options] of mocks.createV2NodePgContainer.mock.calls) {
      expect(options).toMatchObject({
        ensureSchema: false,
        tableQueryOps: { ensureSchema: false, ensureObservationSchema: false },
      });
    }
    expect(tableQueryObservationRuntime.get).not.toHaveBeenCalled();
    expect(mocks.startTableQueryOpsAnalyzerIfEnabled).not.toHaveBeenCalled();
    expect(mocks.startTableQueryOpsTaskWorkerIfEnabled).not.toHaveBeenCalled();
    expect(mocks.startTableQueryOpsManualSearchTaskWorker).not.toHaveBeenCalled();
  });

  it('promotes preview metadata workers only on a later normal acquisition', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();
    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_ANALYZER_ENABLED') return 'true';
      return undefined;
    });

    await service.getPreviewContainer();
    await service.getPreviewContainer();
    expect(mocks.startTableQueryOpsAnalyzerIfEnabled).not.toHaveBeenCalled();
    expect(mocks.startTableQueryOpsTaskWorkerIfEnabled).not.toHaveBeenCalled();
    expect(mocks.startTableQueryOpsManualSearchTaskWorker).not.toHaveBeenCalled();

    await expect(service.getContainer()).resolves.toBe(container);
    expect(mocks.createV2NodePgContainer).toHaveBeenCalledOnce();
    expect(mocks.startTableQueryOpsAnalyzerIfEnabled).toHaveBeenCalledOnce();
    expect(mocks.startTableQueryOpsTaskWorkerIfEnabled).toHaveBeenCalledOnce();
    expect(mocks.startTableQueryOpsManualSearchTaskWorker).toHaveBeenCalledOnce();
  });

  it('reuses a cached container for a metadata-proven preview route', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, dataDbClientManager } = createService();
    dataDbClientManager.getDataDatabaseForTablePreviewReadOnly.mockResolvedValue({
      cacheKey: 'meta-fallback',
      url: 'postgres://test',
      connectionUrl: 'postgres://test',
      isMetaFallback: true,
    });

    await service.getContainer();

    await expect(service.getPreviewContainerForTable('tblxxx')).resolves.toBe(container);
    expect(dataDbClientManager.getDataDatabaseForTablePreviewReadOnly).toHaveBeenCalledWith(
      'tblxxx'
    );
    expect(dataDbClientManager.getDataDatabaseForTable).not.toHaveBeenCalled();
    expect(mocks.createV2NodePgContainer).toHaveBeenCalledOnce();
  });

  it('acquires a cold ready preview route without schema writes or workers', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService, dataDbClientManager, tableQueryObservationRuntime } =
      createService();
    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_ANALYZER_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_AUTO_ACCEPT') return 'auto';
      return undefined;
    });
    dataDbClientManager.getDataDatabaseForTablePreviewReadOnly.mockResolvedValue({
      cacheKey: 'dcn-preview',
      url: 'postgres://space-data-db',
      connectionUrl: 'postgres://space-data-db',
      internalSchema: 'teable_internal',
      isMetaFallback: false,
      connectionId: 'dcn-preview',
    });

    await expect(service.getPreviewContainerForTable('tblxxx')).resolves.toBe(container);

    expect(dataDbClientManager.getDataDatabaseForTable).not.toHaveBeenCalled();
    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        ensureSchema: false,
        tableQueryOps: expect.objectContaining({
          ensureSchema: false,
          ensureObservationSchema: false,
        }),
      })
    );
    expect(tableQueryObservationRuntime.get).not.toHaveBeenCalled();
    expect(mocks.startTableQueryOpsAnalyzerIfEnabled).not.toHaveBeenCalled();
    expect(mocks.startTableQueryOpsTaskWorkerIfEnabled).not.toHaveBeenCalled();
    expect(mocks.startTableQueryOpsManualSearchTaskWorker).not.toHaveBeenCalled();
  });

  it('reacquires an evicted ready preview route into the normal runtime cache', async () => {
    const warmContainer = createContainerMock();
    const reacquiredContainer = createContainerMock();
    mocks.createV2NodePgContainer
      .mockResolvedValueOnce(warmContainer)
      .mockResolvedValueOnce(reacquiredContainer);
    const { service, dataDbClientManager, runtimeCache } = createService();
    const route = {
      cacheKey: 'dcn-preview',
      url: 'postgres://space-data-db',
      connectionUrl: 'postgres://space-data-db',
      internalSchema: 'teable_internal',
      isMetaFallback: false,
      connectionId: 'dcn-preview',
    };
    dataDbClientManager.getDataDatabaseForTable.mockResolvedValue(route);
    dataDbClientManager.getDataDatabaseForTablePreviewReadOnly.mockResolvedValue(route);

    await expect(service.getContainerForTable('tblxxx')).resolves.toBe(warmContainer);
    await runtimeCache.deleteByKey(route.cacheKey);

    await expect(service.getPreviewContainerForTable('tblxxx')).resolves.toBe(reacquiredContainer);
    expect(mocks.createV2NodePgContainer).toHaveBeenCalledTimes(2);
  });

  it('promotes a preview-created container to normal workers on a regular acquisition', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService, dataDbClientManager } = createService();
    configService.get.mockImplementation((key: string) => {
      if (key === 'V2_TABLE_QUERY_OPS_ENABLED') return 'true';
      if (key === 'V2_TABLE_QUERY_OPS_ANALYZER_ENABLED') return 'true';
      return undefined;
    });
    const route = {
      cacheKey: 'dcn-preview',
      url: 'postgres://space-data-db',
      connectionUrl: 'postgres://space-data-db',
      internalSchema: 'teable_internal',
      isMetaFallback: false,
      connectionId: 'dcn-preview',
    };
    dataDbClientManager.getDataDatabaseForTablePreviewReadOnly.mockResolvedValue(route);
    dataDbClientManager.getDataDatabaseForTable.mockResolvedValue(route);

    await service.getPreviewContainerForTable('tblxxx');
    expect(mocks.startTableQueryOpsAnalyzerIfEnabled).not.toHaveBeenCalled();

    await expect(service.getContainerForTable('tblxxx')).resolves.toBe(container);
    expect(mocks.createV2NodePgContainer).toHaveBeenCalledOnce();
    expect(mocks.startTableQueryOpsAnalyzerIfEnabled).toHaveBeenCalledOnce();
    expect(mocks.startTableQueryOpsTaskWorkerIfEnabled).toHaveBeenCalledOnce();
    expect(mocks.startTableQueryOpsManualSearchTaskWorker).toHaveBeenCalledOnce();
  });

  it('rejects a cached container whose connection signature no longer matches metadata', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, dataDbClientManager } = createService();
    dataDbClientManager.getDataDatabaseForTable.mockResolvedValue({
      cacheKey: 'dcn-preview',
      url: 'postgres://old-data-db',
      connectionUrl: 'postgres://old-data-db',
      internalSchema: 'teable_internal',
      isMetaFallback: false,
      connectionId: 'dcn-preview',
    });
    dataDbClientManager.getDataDatabaseForTablePreviewReadOnly.mockResolvedValue({
      cacheKey: 'dcn-preview',
      url: 'postgres://new-data-db',
      connectionUrl: 'postgres://new-data-db',
      internalSchema: 'teable_internal',
      isMetaFallback: false,
      connectionId: 'dcn-preview',
    });

    await service.getContainerForTable('tblxxx');

    await expect(service.getPreviewContainerForTable('tblxxx')).resolves.toBeNull();
    expect(mocks.createV2NodePgContainer).toHaveBeenCalledOnce();
  });

  it('falls back to DATABASE_URL when neither meta nor legacy alias is configured', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();

    configService.get.mockReturnValue(undefined);
    configService.getOrThrow.mockImplementation((key: string) => {
      expect(key).toBe('DATABASE_URL');
      return fallbackDatabaseUrl;
    });

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        metaConnectionString: fallbackDatabaseUrl,
        dataConnectionString: fallbackDatabaseUrl,
      })
    );
  });

  it('fails fast during Nest bootstrap when shared container initialization fails', async () => {
    const registrar = new TestProjectionRegistrar();
    const { module, discoveryService } = await createTestingModule([
      createProviderWrapper(registrar),
    ]);

    mocks.createV2NodePgContainer.mockRejectedValueOnce(new Error('boom'));

    await expect((module as TestingModule).init()).rejects.toThrow('boom');
    expect(mocks.createV2NodePgContainer).toHaveBeenCalledTimes(1);
    expect(discoveryService.getProviders).not.toHaveBeenCalled();
    expect(registrar.registerProjections).not.toHaveBeenCalled();
  });

  it('keeps pools alive until active and queued events finish during shutdown', async () => {
    const template = RecordCreated.create({
      baseId: BaseId.generate()._unsafeUnwrap(),
      tableId: TableId.generate()._unsafeUnwrap(),
      recordId: RecordId.generate()._unsafeUnwrap(),
      fieldValues: [],
    });
    class ShutdownEvent implements IDomainEvent {
      readonly name = template.name;
      readonly occurredAt = template.occurredAt;
    }
    const entered = createGate();
    const release = createGate();
    const delivered: number[] = [];
    @EventHandler(ShutdownEvent)
    class ShutdownHandler implements IEventHandler<ShutdownEvent> {
      async handle() {
        if (delivered.length === 0) {
          entered.resolve();
          await release.promise;
        }
        expect(mocks.disposeV2NodePgContainer).not.toHaveBeenCalled();
        delivered.push(delivered.length + 1);
        if (delivered.length === 1) {
          await eventBus.publish(
            { actorId: ActorId.create('usrTestShutdown')._unsafeUnwrap() },
            new ShutdownEvent()
          );
        }
        return ok(undefined);
      }
    }
    const handler = new ShutdownHandler();
    const scheduled: Array<() => Promise<void>> = [];
    const eventBus = new AsyncMemoryEventBus(
      { resolve: <T>() => handler as T },
      { schedule: (task) => scheduled.push(task), recordPublishedEvents: false }
    );
    const container = createContainerMock(eventBus);
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service } = createService();
    await service.getContainer();
    await eventBus.publishMany({ actorId: ActorId.create('usrTestShutdown')._unsafeUnwrap() }, [
      new ShutdownEvent(),
      new ShutdownEvent(),
    ]);
    const dispatch = scheduled.shift()!();
    await entered.promise;
    const settling = createGate();
    const settle = eventBus.settled.bind(eventBus);
    vi.spyOn(eventBus, 'settled').mockImplementation(() => {
      settling.resolve();
      return settle();
    });
    const shutdown = service.onModuleDestroy();
    try {
      expect(
        await Promise.race([
          settling.promise.then(() => 'draining'),
          shutdown.then(() => 'destroyed'),
        ])
      ).toBe('draining');
      expect(mocks.disposeV2NodePgContainer).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await dispatch;
      await shutdown;
    }
    expect(delivered).toEqual([1, 2, 3]);
    expect(mocks.disposeV2NodePgContainer).toHaveBeenCalledWith(container);
  });

  it('uses one deadline for all runtimes and reports queued events before cleanup', async () => {
    const scheduled: Array<() => Promise<void>> = [];
    const eventBuses = [0, 1].map(
      () =>
        new AsyncMemoryEventBus(
          { resolve: () => undefined as never },
          { schedule: (task) => scheduled.push(task), recordPublishedEvents: false }
        )
    );
    const containers = eventBuses.map((events) => createContainerMock(events));
    mocks.createV2NodePgContainer
      .mockResolvedValueOnce(containers[0])
      .mockResolvedValueOnce(containers[1]);
    const { service, configService, dataDbClientManager, pinoLogger } = createService();
    configService.get.mockImplementation((key: string) =>
      key === 'V2_EVENT_BUS_SHUTDOWN_TIMEOUT_MS' ? '20' : undefined
    );
    dataDbClientManager.getDataDatabaseForSpace.mockResolvedValue({
      cacheKey: 'spc-byodb',
      url: 'postgres://data-db',
      internalSchema: 'teable_meta_x',
      isMetaFallback: false,
    });
    await service.getContainer();
    await service.getContainerForSpace('spc1');
    for (const events of eventBuses) {
      await events.publish(
        { actorId: ActorId.create('usrTestShutdown')._unsafeUnwrap() },
        RecordCreated.create({
          baseId: BaseId.generate()._unsafeUnwrap(),
          tableId: TableId.generate()._unsafeUnwrap(),
          recordId: RecordId.generate()._unsafeUnwrap(),
          fieldValues: [],
        })
      );
    }
    vi.useFakeTimers();
    try {
      const shutdown = service.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(19);
      expect(mocks.disposeV2NodePgContainer).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await shutdown;
      expect(pinoLogger.error).toHaveBeenCalledWith(
        {
          timeoutMs: 20,
          pendingEvents: 2,
          pendingBackgroundTasks: 0,
          pendingCommands: 0,
          pendingProducers: 0,
          context: V2ContainerService.name,
        },
        'V2 event bus shutdown drain timed out'
      );
      expect(mocks.disposeV2NodePgContainer).toHaveBeenCalledTimes(2);
      await service.drainEvents();
      expect(pinoLogger.error).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for an untraced command to publish its event before final settlement', async () => {
    const eventBus = new AsyncMemoryEventBus({ resolve: () => undefined as never });
    mocks.createV2NodePgContainer.mockResolvedValue(createContainerMock(eventBus));
    const { service } = createService();
    await service.getContainer();
    const [options] = mocks.createV2NodePgContainer.mock.calls[0];
    const commands = options.commandBusMiddlewares[0];
    const release = createGate();
    const context = { actorId: ActorId.create('usrTestShutdown')._unsafeUnwrap() };
    const settled = vi.spyOn(eventBus, 'settled');
    const command = commands.handle(context, {}, async () => {
      await release.promise;
      await eventBus.publish(
        context,
        RecordCreated.create({
          baseId: BaseId.generate()._unsafeUnwrap(),
          tableId: TableId.generate()._unsafeUnwrap(),
          recordId: RecordId.generate()._unsafeUnwrap(),
          fieldValues: [],
        })
      );
      return ok(undefined);
    });
    const shutdown = service.onModuleDestroy();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(mocks.disposeV2NodePgContainer).not.toHaveBeenCalled();
    release.resolve();
    await command;
    await shutdown;
    expect(settled).toHaveBeenCalled();
    expect(eventBus.pendingCount()).toBe(0);
    expect(mocks.disposeV2NodePgContainer).toHaveBeenCalledOnce();
  });

  it.each(['timeout', 'failure'] as const)(
    'serializes %s diagnostics through the production pino logger',
    async (outcome) => {
      const eventBus = new AsyncMemoryEventBus(
        { resolve: () => undefined as never },
        { schedule: () => undefined, recordPublishedEvents: false }
      );
      mocks.createV2NodePgContainer.mockResolvedValue(createContainerMock(eventBus));
      const lines: string[] = [];
      const destination = new Writable({
        write(chunk, _encoding, callback) {
          lines.push(chunk.toString());
          callback();
        },
      });
      // Object.create skips PinoLogger's constructor, which would initialize the shared
      // root logger; the fields below are what call() reads on the argument-forwarding path.
      const pinoLogger = Object.assign(Object.create(PinoLogger.prototype) as PinoLogger, {
        context: '',
        contextName: 'context',
        errorKey: 'err',
      });
      const logger = vi
        .spyOn(pinoLogger, 'logger', 'get')
        .mockReturnValue(pinoHttp({ level: 'error' }, destination).logger);
      const { service, configService } = createService([], pinoLogger);
      configService.get.mockImplementation((key: string) =>
        key === 'V2_EVENT_BUS_SHUTDOWN_TIMEOUT_MS' ? '20' : undefined
      );
      await service.getContainer();
      await eventBus.publish(
        { actorId: ActorId.create('usrTestShutdown')._unsafeUnwrap() },
        RecordCreated.create({
          baseId: BaseId.generate()._unsafeUnwrap(),
          tableId: TableId.generate()._unsafeUnwrap(),
          recordId: RecordId.generate()._unsafeUnwrap(),
          fieldValues: [],
        })
      );
      if (outcome === 'failure') {
        vi.spyOn(eventBus, 'settled').mockRejectedValueOnce(new Error('drain failed'));
      }
      vi.useFakeTimers();
      try {
        const shutdown = service.onModuleDestroy();
        if (outcome === 'timeout') {
          await vi.advanceTimersByTimeAsync(20);
        }
        await shutdown;
        const records = lines
          .join('')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        expect(records).toContainEqual(
          expect.objectContaining({
            level: 50,
            context: V2ContainerService.name,
            ...(outcome === 'timeout' ? { timeoutMs: 20 } : {}),
            pendingEvents: 1,
            pendingBackgroundTasks: 0,
            pendingCommands: 0,
            pendingProducers: 0,
            msg: `V2 event bus shutdown drain ${outcome === 'timeout' ? 'timed out' : 'failed'}`,
            ...(outcome === 'failure'
              ? {
                  err: expect.objectContaining({
                    type: 'Error',
                    message: 'drain failed',
                    stack: expect.any(String),
                  }),
                }
              : {}),
          })
        );
      } finally {
        logger.mockRestore();
        vi.useRealTimers();
      }
    }
  );

  it('waits for nested direct background dispatch after the command returns', async () => {
    const backgroundTasks = new BackgroundTaskTracker();
    const eventBus = new AsyncMemoryEventBus(
      { resolve: () => undefined as never },
      { backgroundTasks, recordPublishedEvents: false }
    );
    mocks.createV2NodePgContainer.mockResolvedValue(createContainerMock(eventBus));
    const { service } = createService();
    await service.getContainer();
    const [options] = mocks.createV2NodePgContainer.mock.calls[0] as [IV2NodePgContainerOptions];
    const commands = options.commandBusMiddlewares![0];
    const releaseNested = createGate();
    const nestedStarted = createGate();
    const context = backgroundTasks.context({
      actorId: ActorId.create('usrTestShutdown')._unsafeUnwrap(),
    });
    const command = commands.handle(context, {}, async () => {
      context.scheduleBackgroundTask!(async () => {
        nestedStarted.resolve();
        await releaseNested.promise;
      });
      return ok(undefined);
    });
    const shutdown = service.onModuleDestroy();
    await command;
    await nestedStarted.promise;
    expect(eventBus.pendingBackgroundTaskCount()).toBe(1);
    expect(mocks.disposeV2NodePgContainer).not.toHaveBeenCalled();
    releaseNested.resolve();
    await shutdown;
    expect(eventBus.pendingBackgroundTaskCount()).toBe(0);
    expect(mocks.disposeV2NodePgContainer).toHaveBeenCalledOnce();
  });

  it('destroys the shared V2 db driver during shutdown', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const db = { destroy };
    const container = {
      isRegistered: vi.fn(),
      registerInstance: vi.fn(),
      resolve: vi.fn((token: symbol) => {
        if (token === v2CoreTokens.eventBus) {
          return createContainerMock().resolve(v2CoreTokens.eventBus);
        }
        if (token === v2MetaDbTokens.db || token === v2DataDbTokens.db) {
          return db;
        }
        if (token === v2CoreTokens.attachmentLookupService) {
          return {};
        }
        if (token === v2CoreTokens.attachmentValueDecoratorService) {
          return {};
        }
        if (token === v2CoreTokens.tracer) {
          return {};
        }
        if (token === v2CoreTokens.undoRedoStore) {
          return undefined;
        }
        throw new Error(`Unexpected token: ${String(token)}`);
      }),
    } as unknown as DependencyContainer;

    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, tableQueryObservationRuntime } = createService();

    await service.getContainer();
    await service.onModuleDestroy();

    expect(mocks.disposeV2NodePgContainer).toHaveBeenCalledWith(container);
    expect(destroy).not.toHaveBeenCalled();
    expect(tableQueryObservationRuntime.dispose).toHaveBeenCalledOnce();
  });

  describe('getComputedWriter', () => {
    it('keys writer endpoints by host, port, and database across URL and libpq DSNs', async () => {
      const { service, configService, dataDbClientManager, pgPoolRegistry } = createService();
      configService.get.mockImplementation((key: string) =>
        key === 'PRISMA_META_DATABASE_URL' ? 'postgres://meta-host:5432/meta_db' : undefined
      );

      const makePool = (opts?: { host?: string; port?: number; database?: string; max?: number }) =>
        ({
          connect: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
          idleCount: 0,
          totalCount: 0,
          waitingCount: 0,
          on: vi.fn(),
          options: opts,
        }) as unknown as Pool;

      const pools = new Map<string, Pool>([
        ['postgres://meta-host:5432/meta_db', makePool({ max: 10 })],
        ['postgres://pg-host:5432/tenant_a', makePool({ max: 10 })],
        [
          'postgres://other-user:secret@PG-HOST:5432/tenant_a?sslmode=require',
          makePool({ max: 10 }),
        ],
        ['postgres://pg-host:5432/tenant_b', makePool({ max: 10 })],
        [
          'host=pg-host port=5432 dbname=tenant_c user=app',
          makePool({ host: 'pg-host', port: 5432, max: 10 }),
        ],
        [
          'host=pg-host port=5432 dbname=tenant_d user=app',
          makePool({ host: 'pg-host', port: 5432, max: 10 }),
        ],
        ['dbname=opaque_a', makePool({ max: 10 })],
        ['dbname=opaque_b', makePool({ max: 10 })],
      ]);

      vi.spyOn(pgPoolRegistry, 'acquire').mockImplementation((dsn: string) => ({
        pool: pools.get(dsn) ?? makePool({ max: 10 }),
        release: vi.fn().mockResolvedValue(undefined),
      }));

      const makeContainer = () => createContainerMock();
      mocks.createV2NodePgContainer
        .mockResolvedValueOnce(makeContainer())
        .mockResolvedValueOnce(makeContainer())
        .mockResolvedValueOnce(makeContainer())
        .mockResolvedValueOnce(makeContainer())
        .mockResolvedValueOnce(makeContainer())
        .mockResolvedValueOnce(makeContainer())
        .mockResolvedValueOnce(makeContainer());

      const bindUrl = (id: string, url: string) => {
        dataDbClientManager.getDataDatabaseForBase.mockResolvedValueOnce({
          cacheKey: id,
          url,
          isMetaFallback: false,
          connectionId: id,
        });
      };

      await service.getContainer();
      bindUrl('bse_a1', 'postgres://pg-host:5432/tenant_a');
      const containerA1 = await service.getContainerForBase('bse_a1');
      bindUrl('bse_a2', 'postgres://other-user:secret@PG-HOST:5432/tenant_a?sslmode=require');
      const containerA2 = await service.getContainerForBase('bse_a2');
      bindUrl('bse_b', 'postgres://pg-host:5432/tenant_b');
      const containerB = await service.getContainerForBase('bse_b');
      bindUrl('bse_c', 'host=pg-host port=5432 dbname=tenant_c user=app');
      const containerC = await service.getContainerForBase('bse_c');
      bindUrl('bse_d', 'host=pg-host port=5432 dbname=tenant_d user=app');
      const containerD = await service.getContainerForBase('bse_d');
      bindUrl('bse_o1', 'dbname=opaque_a');
      const containerO1 = await service.getContainerForBase('bse_o1');
      bindUrl('bse_o2', 'dbname=opaque_b');
      const containerO2 = await service.getContainerForBase('bse_o2');

      const writerA1 = service.getComputedWriter(containerA1);
      const writerA2 = service.getComputedWriter(containerA2);
      const writerB = service.getComputedWriter(containerB);
      const writerC = service.getComputedWriter(containerC);
      const writerD = service.getComputedWriter(containerD);
      const writerO1 = service.getComputedWriter(containerO1);
      const writerO2 = service.getComputedWriter(containerO2);

      expect(writerA1.key).toBe(writerA2.key);
      expect(writerA1.key).not.toBe(writerB.key);
      expect(writerC.key).not.toBe(writerD.key);
      expect(writerO1.key).not.toBe(writerO2.key);
    });

    it('enforces writer concurrency=1 and pool headroom on small BYODB pools', async () => {
      const { service, configService, dataDbClientManager, pgPoolRegistry } = createService();
      configService.get.mockImplementation((key: string) =>
        key === 'PRISMA_META_DATABASE_URL' ? 'postgres://meta-host:5432/meta_db' : undefined
      );

      const poolState = new Map<
        string,
        { max: number; totalCount: number; idleCount: number; waitingCount: number }
      >([
        ['bse_p1', { max: 1, totalCount: 0, idleCount: 0, waitingCount: 0 }],
        ['bse_p2', { max: 2, totalCount: 0, idleCount: 0, waitingCount: 0 }],
        ['bse_p6', { max: 6, totalCount: 0, idleCount: 0, waitingCount: 0 }],
      ]);

      vi.spyOn(pgPoolRegistry, 'acquire').mockImplementation((dsn: string) => {
        const id = dsn.split('/').pop() ?? '';
        const state = poolState.get(id) ?? {
          max: 10,
          totalCount: 0,
          idleCount: 0,
          waitingCount: 0,
        };
        const pool = {
          connect: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
          on: vi.fn(),
          options: { max: state.max },
          get totalCount() {
            return state.totalCount;
          },
          get idleCount() {
            return state.idleCount;
          },
          get waitingCount() {
            return state.waitingCount;
          },
        } as unknown as Pool;
        return { pool, release: vi.fn().mockResolvedValue(undefined) };
      });

      mocks.createV2NodePgContainer
        .mockResolvedValueOnce(createContainerMock())
        .mockResolvedValueOnce(createContainerMock())
        .mockResolvedValueOnce(createContainerMock())
        .mockResolvedValueOnce(createContainerMock());

      await service.getContainer();

      const loadWriter = async (baseId: string) => {
        dataDbClientManager.getDataDatabaseForBase.mockResolvedValueOnce({
          cacheKey: baseId,
          url: `postgres://pg-host:5432/${baseId}`,
          isMetaFallback: false,
          connectionId: baseId,
        });
        const container = await service.getContainerForBase(baseId);
        return service.getComputedWriter(container);
      };

      const writer1 = await loadWriter('bse_p1');
      expect(writer1.maxConcurrency).toBe(1);
      expect(writer1.hasWaiters()).toBe(false);
      poolState.get('bse_p1')!.totalCount = 1;
      expect(writer1.hasWaiters()).toBe(true);

      const writer2 = await loadWriter('bse_p2');
      expect(writer2.maxConcurrency).toBe(1);
      poolState.get('bse_p2')!.totalCount = 1;
      poolState.get('bse_p2')!.idleCount = 1;
      expect(writer2.hasWaiters()).toBe(false);
      poolState.get('bse_p2')!.totalCount = 2;
      poolState.get('bse_p2')!.idleCount = 1;
      expect(writer2.hasWaiters()).toBe(true);

      const writer6 = await loadWriter('bse_p6');
      expect(writer6.maxConcurrency).toBe(3);
      poolState.get('bse_p6')!.totalCount = 5;
      poolState.get('bse_p6')!.idleCount = 1;
      expect(writer6.hasWaiters()).toBe(false);
      poolState.get('bse_p6')!.totalCount = 6;
      poolState.get('bse_p6')!.idleCount = 1;
      expect(writer6.hasWaiters()).toBe(true);
    });
  });
});
