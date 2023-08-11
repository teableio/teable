import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import type { Request } from 'express';
import { nanoid } from 'nanoid';
import { ClsModule } from 'nestjs-cls';
import { TeableConfigModule } from './configs/config.module';
import { X_REQUEST_ID } from './const';
import { AggregationOpenApiModule } from './features/aggregation/open-api/aggregation-open-api.module';
import { AttachmentsModule } from './features/attachments/attachments.module';
import { AutomationModule } from './features/automation/automation.module';
import { ChatModule } from './features/chat/chat.module';
import { FileTreeModule } from './features/file-tree/file-tree.module';
import { NextModule } from './features/next/next.module';
import { SelectionModule } from './features/selection/selection.module';
import { TableOpenApiModule } from './features/table/open-api/table-open-api.module';
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
    NextModule,
    FileTreeModule,
    TableOpenApiModule,
    ChatModule,
    AttachmentsModule,
    AutomationModule,
    WsModule,
    SelectionModule,
    AggregationOpenApiModule,
    EventEmitterModule.forRoot(),
  ],
})
export class AppModule {}
