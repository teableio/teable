import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  ShareDbPubSubPublisher,
  registerV2ShareDbRealtime,
} from '@teable/v2-adapter-realtime-sharedb';
import { createV2NodePgContainer } from '@teable/v2-container-node';
import type { DependencyContainer } from '@teable/v2-di' with { 'resolution-mode': 'import' };
import { PinoLogger } from 'nestjs-pino';
import { ShareDbService } from '../../share-db/share-db.service';
import { CommandBusTracingMiddleware } from './v2-command-bus-tracing.middleware';
import { PinoLoggerAdapter } from './v2-logger.adapter';
import { QueryBusTracingMiddleware } from './v2-query-bus-tracing.middleware';
import { OpenTelemetryTracer } from './v2-tracer.adapter';

@Injectable()
export class V2ContainerService implements OnModuleDestroy {
  private containerPromise?: Promise<DependencyContainer>;

  constructor(
    private readonly configService: ConfigService,
    private readonly pinoLogger: PinoLogger,
    private readonly shareDbService: ShareDbService
  ) {}

  async getContainer(): Promise<DependencyContainer> {
    if (!this.containerPromise) {
      const connectionString = this.configService.getOrThrow<string>('PRISMA_DATABASE_URL');
      const logger = new PinoLoggerAdapter(this.pinoLogger);
      const tracer = new OpenTelemetryTracer();
      const commandBusMiddlewares = [new CommandBusTracingMiddleware()];
      const queryBusMiddlewares = [new QueryBusTracingMiddleware()];
      this.containerPromise = createV2NodePgContainer({
        connectionString,
        logger,
        tracer,
        commandBusMiddlewares,
        queryBusMiddlewares,
      }).then((container) => {
        registerV2ShareDbRealtime(container, {
          publisher: new ShareDbPubSubPublisher(this.shareDbService.pubsub),
        });
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
