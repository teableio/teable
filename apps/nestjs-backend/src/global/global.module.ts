import type { DynamicModule, MiddlewareConsumer, ModuleMetadata, NestModule } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { context, trace } from '@opentelemetry/api';
import { PrismaModule } from '@teable/db-main-prisma';
import type { Request } from 'express';
import { nanoid } from 'nanoid';
import { ClsMiddleware, ClsModule } from 'nestjs-cls';
import { CacheModule } from '../cache/cache.module';
import { ConfigModule } from '../configs/config.module';
import { X_REQUEST_ID } from '../const';
import { DbProvider } from '../db-provider/db.provider';
import { EventEmitterModule } from '../event-emitter/event-emitter.module';
import { AuthGuard } from '../features/auth/guard/auth.guard';
import { PermissionGuard } from '../features/auth/guard/permission.guard';
import { PermissionModule } from '../features/auth/permission.module';
import { DataLoaderModule } from '../features/data-loader/data-loader.module';
import { ModelModule } from '../features/model/model.module';
import { RequestInfoMiddleware } from '../middleware/request-info.middleware';
import { PerformanceCacheModule } from '../performance-cache';
import { RouteTracingInterceptor } from '../tracing/route-tracing.interceptor';
import { KnexModule } from './knex';

const globalModules = {
  imports: [
    ConfigModule.register(),
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) => {
          const existingID = req.headers[X_REQUEST_ID] as string;
          if (existingID) return existingID;

          const span = trace.getSpan(context.active());
          if (!span) return nanoid();

          const { traceId } = span.spanContext();
          return traceId;
        },
      },
    }),
    CacheModule.register({ global: true }),
    EventEmitterModule.register({ global: true }),
    KnexModule.register(),
    ModelModule,
    PrismaModule,
    PermissionModule,
    DataLoaderModule,
    PerformanceCacheModule,
  ],
  // for overriding the default TablePermissionService, FieldPermissionService, RecordPermissionService, and ViewPermissionService
  providers: [
    DbProvider,
    RequestInfoMiddleware,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RouteTracingInterceptor,
    },
  ],
  exports: [DbProvider],
};

@Global()
@Module(globalModules)
export class GlobalModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ClsMiddleware).forRoutes('*').apply(RequestInfoMiddleware).forRoutes('*');
  }

  static register(moduleMetadata: ModuleMetadata): DynamicModule {
    return {
      module: GlobalModule,
      global: true,
      imports: [...globalModules.imports, ...(moduleMetadata.imports || [])],
      providers: [...globalModules.providers, ...(moduleMetadata.providers || [])],
      exports: [...globalModules.exports, ...(moduleMetadata.exports || [])],
    };
  }
}
