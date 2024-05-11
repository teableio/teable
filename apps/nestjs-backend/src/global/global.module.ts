import type { DynamicModule, MiddlewareConsumer, ModuleMetadata, NestModule } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
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
import { PermissionModule } from '../features/auth/permission.module';
import { FieldPermissionService } from '../features/field/field-permission.service';
import { MailSenderModule } from '../features/mail-sender/mail-sender.module';
import { RecordPermissionService } from '../features/record/record-permission.service';
import { TablePermissionService } from '../features/table/table-permission.service';
import { ViewPermissionService } from '../features/view/view-permission.service';
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
    MailSenderModule.register({ global: true }),
    EventEmitterModule.register({ global: true }),
    KnexModule.register(),
    PrismaModule,
    PermissionModule,
  ],
  // for overriding the default TablePermissionService, FieldPermissionService, RecordPermissionService, and ViewPermissionService
  providers: [
    DbProvider,
    FieldPermissionService,
    RecordPermissionService,
    ViewPermissionService,
    TablePermissionService,
  ],
  exports: [
    DbProvider,
    FieldPermissionService,
    RecordPermissionService,
    ViewPermissionService,
    TablePermissionService,
  ],
};

@Global()
@Module(globalModules)
export class GlobalModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ClsMiddleware).forRoutes('*');
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
