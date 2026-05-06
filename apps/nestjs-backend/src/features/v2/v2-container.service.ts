import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryService, Reflector } from '@nestjs/core';
import type { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  ShareDbPubSubPublisher,
  registerV2ShareDbRealtime,
} from '@teable/v2-adapter-realtime-sharedb';
import { v2RecordRepositoryPostgresTokens } from '@teable/v2-adapter-table-repository-postgres';
import { KeyvUndoRedoStore } from '@teable/v2-adapter-undo-redo-keyv';
import { createV2NodePgContainer } from '@teable/v2-container-node';
import type { AttachmentValueDecoratorService, IAttachmentLookupService } from '@teable/v2-core';
import { v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { registerV2ImportServices } from '@teable/v2-import';
import { PinoLogger } from 'nestjs-pino';
import { CacheService } from '../../cache/cache.service';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { ShareDbService } from '../../share-db/share-db.service';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import { V2AttachmentUrlSignerService } from './v2-attachment-url-signer.service';
import { CommandBusTracingMiddleware } from './v2-command-bus-tracing.middleware';
import { PinoLoggerAdapter } from './v2-logger.adapter';
import {
  V2_PROJECTION_REGISTRAR_METADATA,
  isV2ProjectionRegistrar,
  type IV2ProjectionRegistrar,
} from './v2-projection-registrar';
import { QueryBusTracingMiddleware } from './v2-query-bus-tracing.middleware';
import { V2RecordChangedValueDecoratorService } from './v2-record-changed-value-decorator.service';
import { OpenTelemetryTracer } from './v2-tracer.adapter';

@Injectable()
export class V2ContainerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(V2ContainerService.name);
  private containerPromise?: Promise<DependencyContainer>;

  constructor(
    private readonly configService: ConfigService,
    private readonly pinoLogger: PinoLogger,
    private readonly shareDbService: ShareDbService,
    private readonly cacheService: CacheService,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly reflector: Reflector,
    private readonly discoveryService: DiscoveryService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.getContainer();
  }

  async getContainer(): Promise<DependencyContainer> {
    if (!this.containerPromise) {
      this.containerPromise = this.createContainer().catch((error) => {
        this.containerPromise = undefined;
        throw error;
      });
    }

    return this.containerPromise;
  }

  private async createContainer(): Promise<DependencyContainer> {
    const metaConnectionString =
      this.configService.get<string>('PRISMA_META_DATABASE_URL') ??
      this.configService.get<string>('PRISMA_DATABASE_URL') ??
      this.configService.getOrThrow<string>('DATABASE_URL');
    const dataConnectionString =
      this.configService.get<string>('PRISMA_DATA_DATABASE_URL') ?? metaConnectionString;
    const logger = new PinoLoggerAdapter(this.pinoLogger);
    const tracer = new OpenTelemetryTracer();
    const commandBusMiddlewares = [new CommandBusTracingMiddleware()];
    const queryBusMiddlewares = [new QueryBusTracingMiddleware()];
    const computedUpdateMode = process.env.V2_COMPUTED_UPDATE_MODE;

    this.logger.log('Initializing shared V2 container');

    const container = await createV2NodePgContainer({
      metaConnectionString,
      dataConnectionString,
      logger,
      tracer,
      commandBusMiddlewares,
      queryBusMiddlewares,
      computedUpdate: computedUpdateMode === 'sync' ? { mode: 'sync' } : undefined,
      maxFreeRowLimit: this.configService.get<number>('MAX_FREE_ROW_LIMIT'),
    });

    registerV2ShareDbRealtime(container, {
      publisher: new ShareDbPubSubPublisher(this.shareDbService.pubsub),
    });
    const attachmentLookupService = container.resolve<IAttachmentLookupService>(
      v2CoreTokens.attachmentLookupService
    );
    container.registerInstance(
      v2CoreTokens.attachmentUrlSignerService,
      new V2AttachmentUrlSignerService(
        this.attachmentsStorageService,
        attachmentLookupService,
        this.cacheService
      )
    );
    const attachmentValueDecoratorService = container.resolve<AttachmentValueDecoratorService>(
      v2CoreTokens.attachmentValueDecoratorService
    );
    container.registerInstance(
      v2CoreTokens.recordChangedValueDecoratorService,
      new V2RecordChangedValueDecoratorService(attachmentValueDecoratorService)
    );
    container.registerInstance(
      v2CoreTokens.undoRedoStore,
      new KeyvUndoRedoStore(this.cacheService.getKeyv(), {
        keyPrefix: 'v2:undo-redo',
        ttlMs: this.thresholdConfig.undoExpirationTime * 1000,
        maxEntries: this.thresholdConfig.maxUndoStackSize,
      })
    );
    // Register V2 import services (csv, excel adapters)
    registerV2ImportServices(container);

    for (const registrar of this.discoverProjectionRegistrars()) {
      registrar.registerProjections(container);
    }

    this.logger.log('Shared V2 container initialized');
    return container;
  }

  private discoverProjectionRegistrars(): IV2ProjectionRegistrar[] {
    const seen = new Set<IV2ProjectionRegistrar>();
    const registrars: IV2ProjectionRegistrar[] = [];

    for (const wrapper of this.discoveryService.getProviders()) {
      const registrar = this.getProjectionRegistrar(wrapper);
      if (!registrar || seen.has(registrar)) {
        continue;
      }

      seen.add(registrar);
      registrars.push(registrar);
    }

    return registrars;
  }

  private getProjectionRegistrar(wrapper: InstanceWrapper): IV2ProjectionRegistrar | null {
    const target =
      !wrapper.metatype || wrapper.inject ? wrapper.instance?.constructor : wrapper.metatype;
    if (!target || !this.reflector.get(V2_PROJECTION_REGISTRAR_METADATA, target)) {
      return null;
    }

    const name = target.name || wrapper.name || String(wrapper.token);
    if (!wrapper.isDependencyTreeStatic()) {
      throw new Error(`V2 projection registrar "${name}" must be statically scoped`);
    }

    if (!isV2ProjectionRegistrar(wrapper.instance)) {
      throw new Error(`V2 projection registrar "${name}" is not instantiated during bootstrap`);
    }

    return wrapper.instance;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.containerPromise) return;

    const container = await this.containerPromise;
    await this.stopComputedUpdatePolling(container);
    const closers = Array.from(
      new Set([
        container.resolve<{ destroy(): Promise<void> }>(v2MetaDbTokens.db),
        container.resolve<{ destroy(): Promise<void> }>(v2DataDbTokens.db),
      ])
    );
    await Promise.all(closers.map((db) => db.destroy()));
  }

  private async stopComputedUpdatePolling(container: DependencyContainer): Promise<void> {
    if (!container.isRegistered(v2RecordRepositoryPostgresTokens.computedUpdatePollingConfig)) {
      return;
    }

    const pollingConfig = container.resolve<{ enabled?: boolean }>(
      v2RecordRepositoryPostgresTokens.computedUpdatePollingConfig
    );
    if (!pollingConfig.enabled) {
      return;
    }

    if (!container.isRegistered(v2RecordRepositoryPostgresTokens.computedUpdatePollingService)) {
      return;
    }

    const pollingService = container.resolve<{ stop(): Promise<void> }>(
      v2RecordRepositoryPostgresTokens.computedUpdatePollingService
    );
    await pollingService.stop();
  }
}
