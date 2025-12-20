import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createV2NodePgContainer } from '@teable/v2-container-node';
import { v2PostgresDbTokens } from '@teable/v2-db-postgres';
import type { DependencyContainer } from '@teable/v2-di';
import { PinoLogger } from 'nestjs-pino';
import { CommandBusTracingMiddleware } from './v2-command-bus-tracing.middleware';
import { PinoLoggerAdapter } from './v2-logger.adapter';
import { QueryBusTracingMiddleware } from './v2-query-bus-tracing.middleware';
import { OpenTelemetryTracer } from './v2-tracer.adapter';

@Injectable()
export class V2ContainerService implements OnModuleDestroy {
  private containerPromise?: Promise<DependencyContainer>;

  constructor(
    private readonly configService: ConfigService,
    private readonly pinoLogger: PinoLogger
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
