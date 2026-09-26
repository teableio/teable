import type { DynamicModule, MiddlewareConsumer, ModuleMetadata, NestModule } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, HttpAdapterHost } from '@nestjs/core';
import { context, trace } from '@opentelemetry/api';
import { DataPrismaModule } from '@teable/db-data-prisma';
import { PrismaModule } from '@teable/db-main-prisma';
import type { Request } from 'express';
import { nanoid } from 'nanoid';
import { ClsMiddleware, ClsModule } from 'nestjs-cls';
import {
  I18nModule,
  QueryResolver,
  AcceptLanguageResolver,
  HeaderResolver,
  CookieResolver,
} from 'nestjs-i18n';
import qs from 'qs';
import { CacheModule } from '../cache/cache.module';
import { ConfigModule } from '../configs/config.module';
import { X_REQUEST_ID } from '../const';
import { DbProvider } from '../db-provider/db.provider';
import { EventEmitterModule } from '../event-emitter/event-emitter.module';
import { AuditSourceModule } from '../features/audit/audit.module';
import { AuthGuard } from '../features/auth/guard/auth.guard';
import { PermissionGuard } from '../features/auth/guard/permission.guard';
import { TeableJwtModule } from '../features/auth/jwt/teable-jwt.module';
import { PermissionModule } from '../features/auth/permission.module';
import { DataLoaderModule } from '../features/data-loader/data-loader.module';
import { ModelModule } from '../features/model/model.module';
import { DataDbHealthService } from '../features/space/data-db-health.service';
import { DataDbMigrationService } from '../features/space/data-db-migration.service';
import { SpaceDataDbMigrationGuardService } from '../features/space/space-data-db-migration-guard.service';
import { InteractiveQueryCancellationInterceptor } from '../features/v2/interactive-query-cancellation.interceptor';
import { RequestInfoMiddleware } from '../middleware/request-info.middleware';
import { SessionCsrfMiddleware } from '../middleware/session-csrf.middleware';
import { PerformanceCacheModule } from '../performance-cache';
import { RouteTracingInterceptor } from '../tracing/route-tracing.interceptor';
import { getI18nPath, getI18nTypesOutputPath } from '../utils/i18n.js';
import { DataDbClientManager } from './data-db-client-manager.service';
import { DataDbRuntimeCacheService } from './data-db-runtime-cache.service';
import { DatabaseClientPoolMetrics } from './database-client-pool.metrics';
import { DatabaseRouter } from './database-router.service';
import { KnexModule } from './knex';

/**
 * Express 5 ships qs 6.15, whose `arrayLimit` (20) now also applies to `ids[]=…` and repeated
 * keys, turning longer arrays into index-keyed objects; Express 4's qs 6.13 only capped explicit
 * indices. Bulk endpoints legitimately receive hundreds of ids, and the URL length already bounds
 * the query, so keep Express 4's shape with a generous cap.
 */
const QUERY_ARRAY_LIMIT = 10_000;

const globalModules = {
  imports: [
    ConfigModule.register(),
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: false,
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
    AuditSourceModule,
    KnexModule.register(),
    ModelModule,
    PrismaModule,
    DataPrismaModule,
    PermissionModule,
    DataLoaderModule,
    PerformanceCacheModule,
    TeableJwtModule,
    I18nModule.forRootAsync({
      useFactory: () => {
        const i18nPath = getI18nPath();
        const typesOutputPath = getI18nTypesOutputPath();
        return {
          fallbackLanguage: 'en',
          loaderOptions: {
            path: i18nPath,
            watch: process.env.NODE_ENV !== 'production',
          },
          typesOutputPath,
          formatter: (template: string, ...args: Array<string | Record<string, string>>) => {
            // replace {{field}} to {$field}
            const normalized = template.replace(/\{\{\s*(\w+)\s*\}\}/g, '{$1}');
            const options = I18nModule['sanitizeI18nOptions']();
            return options.formatter(normalized, ...args);
          },
        };
      },
      resolvers: [
        { use: QueryResolver, options: ['lang'] },
        { use: CookieResolver, options: ['NEXT_LOCALE'] },
        AcceptLanguageResolver,
        new HeaderResolver(['x-lang']),
      ],
    }),
  ],

  // for overriding the default TablePermissionService, FieldPermissionService, RecordPermissionService, and ViewPermissionService
  providers: [
    DbProvider,
    DataDbRuntimeCacheService,
    DataDbClientManager,
    DatabaseClientPoolMetrics,
    DataDbMigrationService,
    DataDbHealthService,
    SpaceDataDbMigrationGuardService,
    DatabaseRouter,
    RequestInfoMiddleware,
    SessionCsrfMiddleware,
    InteractiveQueryCancellationInterceptor,
    ClsMiddleware,
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
  exports: [
    DbProvider,
    DataDbRuntimeCacheService,
    DataDbClientManager,
    DataDbMigrationService,
    DataDbHealthService,
    SpaceDataDbMigrationGuardService,
    DatabaseRouter,
    InteractiveQueryCancellationInterceptor,
    KnexModule,
    PrismaModule,
    DataPrismaModule,
  ],
};

@Global()
@Module(globalModules)
export class GlobalModule implements NestModule {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly clsMiddleware: ClsMiddleware
  ) {}

  configure(consumer: MiddlewareConsumer) {
    const expressApp = this.httpAdapterHost.httpAdapter?.getInstance?.();
    // Express 5 defaults to its "simple" query parser, which no longer expands the
    // bracket syntax (`filter[a]=1`, `ids[]=x`) that axios and the SDK send. Restore
    // the qs-based "extended" parser Express 4 used so req.query keeps its shape.
    expressApp?.set?.('query parser', (query: string) =>
      qs.parse(query, { allowPrototypes: true, arrayLimit: QUERY_ARRAY_LIMIT })
    );
    // Mount the CLS middleware straight on the Express instance: configure() runs before
    // Nest applies any module middleware, so the request context (and its request id, which
    // nestjs-pino's genReqId reads) exists for every later middleware. Since Nest 11 module
    // middleware runs in module registration order, which the EE module graph does not
    // control, and a consumer-based registration could end up after the request logger.
    expressApp?.use?.(this.clsMiddleware.use);

    consumer
      .apply(SessionCsrfMiddleware)
      .forRoutes('{*splat}')
      .apply(RequestInfoMiddleware)
      .forRoutes('{*splat}');
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
