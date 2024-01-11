import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '@teable-group/db-main-prisma';
import type { Request } from 'express';
import { nanoid } from 'nanoid';
import { ClsMiddleware, ClsModule } from 'nestjs-cls';
import { CacheModule } from '../cache/cache.module';
import type { IAuthConfig } from '../configs/auth.config';
import { authConfig } from '../configs/auth.config';
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
        idGenerator: (req: Request) => (req.headers[X_REQUEST_ID] as string) ?? nanoid(),
      },
    }),
    JwtModule.registerAsync({
      global: true,
      useFactory: (config: IAuthConfig) => ({
        secret: config.jwt.secret,
        signOptions: {
          expiresIn: config.jwt.expiresIn,
        },
      }),
      inject: [authConfig.KEY],
    }),
    MailSenderModule.register({ global: true }),
    EventEmitterModule.register({ global: true }),
    KnexModule.register(),
    PrismaModule,
    PermissionModule,
    CacheModule,
  ],
})
export class GlobalModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ClsMiddleware).forRoutes('*');
  }
}
