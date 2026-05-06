import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { DiscoveryService, Reflector } from '@nestjs/core';
import type { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { Test, type TestingModule } from '@nestjs/testing';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { v2RecordRepositoryPostgresTokens } from '@teable/v2-adapter-table-repository-postgres';
import { v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { PinoLogger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../attachments/attachments-storage.service', () => ({
  AttachmentsStorageService: class AttachmentsStorageService {},
}));

import { CacheService } from '../../cache/cache.service';
import { thresholdConfig } from '../../configs/threshold.config';
import { ShareDbService } from '../../share-db/share-db.service';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';
import { V2ContainerService } from './v2-container.service';

const mocks = vi.hoisted(() => ({
  createV2NodePgContainer: vi.fn(),
  registerV2ShareDbRealtime: vi.fn(),
  registerV2ImportServices: vi.fn(),
}));

vi.mock('@teable/v2-container-node', () => ({
  createV2NodePgContainer: mocks.createV2NodePgContainer,
}));

vi.mock('@teable/v2-adapter-realtime-sharedb', () => ({
  ShareDbPubSubPublisher: class ShareDbPubSubPublisher {
    constructor(readonly pubsub: unknown) {}
  },
  registerV2ShareDbRealtime: mocks.registerV2ShareDbRealtime,
}));

vi.mock('@teable/v2-import', () => ({
  registerV2ImportServices: mocks.registerV2ImportServices,
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

vi.mock('./v2-command-bus-tracing.middleware', () => ({
  CommandBusTracingMiddleware: class CommandBusTracingMiddleware {},
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

const createProviderWrapper = (instance: object, staticTree = true): InstanceWrapper<object> =>
  ({
    instance,
    metatype: instance.constructor,
    inject: undefined,
    token: instance.constructor,
    name: instance.constructor.name,
    isDependencyTreeStatic: () => staticTree,
  }) as InstanceWrapper<object>;

const createContainerMock = (): DependencyContainer => {
  const db = { destroy: vi.fn() };
  return {
    isRegistered: vi.fn(
      (token: symbol) =>
        token === v2RecordRepositoryPostgresTokens.computedUpdatePollingConfig ||
        token === v2RecordRepositoryPostgresTokens.computedUpdatePollingService
    ),
    registerInstance: vi.fn(),
    resolve: vi.fn((token: symbol) => {
      if (token === v2MetaDbTokens.db || token === v2DataDbTokens.db) {
        return db;
      }
      if (token === v2CoreTokens.attachmentLookupService) {
        return {};
      }
      if (token === v2CoreTokens.attachmentValueDecoratorService) {
        return {};
      }
      if (token === v2RecordRepositoryPostgresTokens.computedUpdatePollingConfig) {
        return { enabled: true };
      }
      if (token === v2RecordRepositoryPostgresTokens.computedUpdatePollingService) {
        return { stop: vi.fn() };
      }
      if (token === v2CoreTokens.undoRedoStore) {
        return undefined;
      }
      throw new Error(`Unexpected token: ${String(token)}`);
    }),
  } as unknown as DependencyContainer;
};

const createService = (providers: InstanceWrapper[] = []) => {
  const configService = {
    getOrThrow: vi.fn().mockReturnValue('postgres://test'),
    get: vi.fn().mockReturnValue(undefined),
  };
  const shareDbService = { pubsub: { publish: vi.fn() } };
  const cacheService = { getKeyv: vi.fn().mockReturnValue({}) };
  const attachmentsStorageService = {
    getPreviewUrlByPath: vi.fn(),
    getTableThumbnailUrl: vi.fn(),
  };
  const reflector = new Reflector();
  const discoveryService = {
    getProviders: vi.fn().mockReturnValue(providers),
  } as unknown as DiscoveryService;

  const service = new V2ContainerService(
    configService as never,
    {} as PinoLogger,
    shareDbService as never,
    cacheService as never,
    attachmentsStorageService as never,
    { undoExpirationTime: 60, maxUndoStackSize: 20 } as never,
    reflector,
    discoveryService
  );

  return {
    service,
    configService,
    shareDbService,
    cacheService,
    attachmentsStorageService,
    discoveryService,
  };
};

const createTestingModule = async (providers: InstanceWrapper[] = []) => {
  const configService = {
    getOrThrow: vi.fn().mockReturnValue('postgres://test'),
    get: vi.fn().mockReturnValue(undefined),
  };
  const shareDbService = { pubsub: { publish: vi.fn() } };
  const cacheService = { getKeyv: vi.fn().mockReturnValue({}) };
  const attachmentsStorageService = {
    getPreviewUrlByPath: vi.fn(),
    getTableThumbnailUrl: vi.fn(),
  };
  const reflector = new Reflector();
  const discoveryService = {
    getProviders: vi.fn().mockReturnValue(providers),
  } as unknown as DiscoveryService;

  const module = await Test.createTestingModule({
    providers: [
      V2ContainerService,
      { provide: ConfigService, useValue: configService },
      { provide: PinoLogger, useValue: {} },
      { provide: ShareDbService, useValue: shareDbService },
      { provide: CacheService, useValue: cacheService },
      { provide: AttachmentsStorageService, useValue: attachmentsStorageService },
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
  });

  it('discovers projection registrars and initializes the shared container during bootstrap', async () => {
    const registrar = new TestProjectionRegistrar();
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, discoveryService } = createService([createProviderWrapper(registrar)]);

    await service.onApplicationBootstrap();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledTimes(1);
    expect(mocks.registerV2ShareDbRealtime).toHaveBeenCalledTimes(1);
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

  it('accepts split meta/data envs without requiring the legacy alias', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();

    configService.get.mockImplementation((key: string) => {
      if (key === 'PRISMA_META_DATABASE_URL') {
        return 'postgres://meta-db';
      }
      if (key === 'PRISMA_DATA_DATABASE_URL') {
        return 'postgres://data-db';
      }
      return undefined;
    });

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        metaConnectionString: 'postgres://meta-db',
        dataConnectionString: 'postgres://data-db',
      })
    );
  });

  it('falls back to DATABASE_URL when neither meta nor legacy alias is configured', async () => {
    const container = createContainerMock();
    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service, configService } = createService();

    configService.get.mockReturnValue(undefined);
    configService.getOrThrow.mockImplementation((key: string) => {
      expect(key).toBe('DATABASE_URL');
      return 'postgres://fallback-db';
    });

    await service.getContainer();

    expect(mocks.createV2NodePgContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        metaConnectionString: 'postgres://fallback-db',
        dataConnectionString: 'postgres://fallback-db',
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

  it('stops computed polling before destroying the shared V2 db driver', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const db = { destroy };
    const container = {
      isRegistered: vi.fn(
        (token: symbol) =>
          token === v2RecordRepositoryPostgresTokens.computedUpdatePollingConfig ||
          token === v2RecordRepositoryPostgresTokens.computedUpdatePollingService
      ),
      registerInstance: vi.fn(),
      resolve: vi.fn((token: symbol) => {
        if (token === v2RecordRepositoryPostgresTokens.computedUpdatePollingConfig) {
          return { enabled: true };
        }
        if (token === v2RecordRepositoryPostgresTokens.computedUpdatePollingService) {
          return { stop };
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
        if (token === v2CoreTokens.undoRedoStore) {
          return undefined;
        }
        throw new Error(`Unexpected token: ${String(token)}`);
      }),
    } as unknown as DependencyContainer;

    mocks.createV2NodePgContainer.mockResolvedValue(container);
    const { service } = createService();

    await service.getContainer();
    await service.onModuleDestroy();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(destroy.mock.invocationCallOrder[0]);
  });
});
