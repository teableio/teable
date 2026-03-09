import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KeyvUndoRedoStore } from '@teable/v2-adapter-undo-redo-keyv';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  ShareDbPubSubPublisher,
  registerV2ShareDbRealtime,
} from '@teable/v2-adapter-realtime-sharedb';
import { v2CoreTokens } from '@teable/v2-core';
import { createV2NodePgContainer } from '@teable/v2-container-node';
import type { DependencyContainer } from '@teable/v2-di';
import { registerV2ImportServices } from '@teable/v2-import';
import { PinoLogger } from 'nestjs-pino';
import { ShareDbService } from '../../share-db/share-db.service';
import { CacheService } from '../../cache/cache.service';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { V2ActionTriggerService } from './v2-action-trigger.service';
import { CommandBusTracingMiddleware } from './v2-command-bus-tracing.middleware';
import { PinoLoggerAdapter } from './v2-logger.adapter';
import type { IV2ProjectionRegistrar } from './v2-projection-registrar';
import { QueryBusTracingMiddleware } from './v2-query-bus-tracing.middleware';
import { OpenTelemetryTracer } from './v2-tracer.adapter';

@Injectable()
export class V2ContainerService implements OnModuleDestroy {
  private containerPromise?: Promise<DependencyContainer>;
  private readonly dynamicRegistrars: IV2ProjectionRegistrar[] = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly pinoLogger: PinoLogger,
    private readonly shareDbService: ShareDbService,
    private readonly cacheService: CacheService,
    private readonly actionTriggerService: V2ActionTriggerService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  /**
   * Add a projection registrar dynamically.
   * Must be called during module initialization (onModuleInit), before getContainer() is called.
   */
  addProjectionRegistrar(registrar: IV2ProjectionRegistrar): void {
    this.dynamicRegistrars.push(registrar);
  }

  async getContainer(): Promise<DependencyContainer> {
    if (!this.containerPromise) {
      const connectionString = this.configService.getOrThrow<string>('PRISMA_DATABASE_URL');
      const logger = new PinoLoggerAdapter(this.pinoLogger);
      const tracer = new OpenTelemetryTracer();
      const commandBusMiddlewares = [new CommandBusTracingMiddleware()];
      const queryBusMiddlewares = [new QueryBusTracingMiddleware()];
      const computedUpdateMode = process.env.V2_COMPUTED_UPDATE_MODE;
      this.containerPromise = createV2NodePgContainer({
        connectionString,
        logger,
        tracer,
        commandBusMiddlewares,
        queryBusMiddlewares,
        computedUpdate: computedUpdateMode === 'sync' ? { mode: 'sync' } : undefined,
        maxFreeRowLimit: this.configService.get<number>('MAX_FREE_ROW_LIMIT'),
      }).then((container) => {
        registerV2ShareDbRealtime(container, {
          publisher: new ShareDbPubSubPublisher(this.shareDbService.pubsub),
        });
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
        // Register V2 action trigger projections for V1 frontend compatibility
        this.actionTriggerService.registerProjections(container);
        // Register dynamically added projections (audit-log, automation, task, etc.)
        for (const registrar of this.dynamicRegistrars) {
          registrar.registerProjections(container);
        }
        return container;
      });
    }

    return this.containerPromise;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.containerPromise) return;

    const container = await this.containerPromise;
    const db = container.resolve<{ destroy(): Promise<void> }>(v2PostgresDbTokens.db);
    await db.destroy();
  }
}
