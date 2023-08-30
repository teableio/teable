import { Module } from '@nestjs/common';
import { PrismaModule } from '@teable-group/db-main-prisma';
import type { ConfigType } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Request } from 'express';
import { nanoid } from 'nanoid';
import { ClsModule } from 'nestjs-cls';
import { authConfig } from './configs/auth.config';
import { TeableConfigModule } from './configs/config.module';
import { X_REQUEST_ID } from './const';
import { TeableEventEmitterModule } from './event-emitter/event-emitter.module';
import { AggregationOpenApiModule } from './features/aggregation/open-api/aggregation-open-api.module';
import { AttachmentsModule } from './features/attachments/attachments.module';
import { AuthModule } from './features/auth/auth.module';
import { AutomationModule } from './features/automation/automation.module';
import { BaseModule } from './features/base/base.module';
import { ChatModule } from './features/chat/chat.module';
import { ExportImportModule } from './features/export-import/export-import.module';
import { FileTreeModule } from './features/file-tree/file-tree.module';
import { NextModule } from './features/next/next.module';
import { SelectionModule } from './features/selection/selection.module';
import { TableOpenApiModule } from './features/table/open-api/table-open-api.module';
import { UserModule } from './features/user/user.module';
import { TeableLoggerModule } from './logger/logger.module';
import { WsModule } from './ws/ws.module';

@Module({
  imports: [
    // DevtoolsModule.register({
    //   http: process.env.NODE_ENV !== 'production',
    // }),
    TeableConfigModule.register(),
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) => (req.headers[X_REQUEST_ID] as string) ?? nanoid(),
      },
    }),
    TeableLoggerModule.register(),
    TeableEventEmitterModule.register(),
    PrismaModule,
    NextModule,
    FileTreeModule,
    ExportImportModule,
    TableOpenApiModule,
    BaseModule,
    ChatModule,
    AttachmentsModule,
    AutomationModule,
    WsModule,
    SelectionModule,
    AggregationOpenApiModule,
    UserModule,
    JwtModule.registerAsync({
      global: true,
      useFactory: (config: ConfigType<typeof authConfig>) => ({
        secret: config.jwt.secret,
        signOptions: {
          expiresIn: config.jwt.expiresIn,
        },
      }),
      inject: [authConfig.KEY],
    }),
    AuthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
