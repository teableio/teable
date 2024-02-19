import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { context, trace } from '@opentelemetry/api';
import { PrismaModule } from '@teable/db-main-prisma';
import type { Request } from 'express';
import { nanoid } from 'nanoid';
import { ClsMiddleware, ClsModule } from 'nestjs-cls';
import { CacheModule } from '../cache/cache.module';
import { ConfigModule } from '../configs/config.module';
import { X_REQUEST_ID } from '../const';
import { EventEmitterModule } from '../event-emitter/event-emitter.module';
import { PermissionModule } from '../features/auth/permission.module';
import { MailSenderModule } from '../features/mail-sender/mail-sender.module';
import { KnexModule } from './knex';

@Global()
@Module({
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
})
export class GlobalModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ClsMiddleware).forRoutes('*');
  }
}
