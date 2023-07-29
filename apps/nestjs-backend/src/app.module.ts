import { Module } from '@nestjs/common';
import { DevtoolsModule } from '@nestjs/devtools-integration';
import { EventEmitterModule } from '@nestjs/event-emitter';
import type { Request } from 'express';
import { nanoid } from 'nanoid';
import { ClsModule } from 'nestjs-cls';
import { TeableConfigModule } from './configs/config.module';
import { X_REQUEST_ID } from './const';
import { AttachmentsModule } from './features/attachments/attachments.module';
import { AutomationModule } from './features/automation/automation.module';
import { ChatModule } from './features/chat/chat.module';
import { CopyPasteModule } from './features/copy-paste/copy-paste.module';
import { FileTreeModule } from './features/file-tree/file-tree.module';
import { NextModule } from './features/next/next.module';
import { TableOpenApiModule } from './features/table/open-api/table-open-api.module';
import { TeableLoggerModule } from './logger/logger.module';
import { WsModule } from './ws/ws.module';

@Module({
  imports: [
    DevtoolsModule.register({
      http: process.env.NODE_ENV !== 'production',
    }),
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
    CopyPasteModule,
    EventEmitterModule.forRoot({
      // set this to `true` to use wildcards
      wildcard: false,
      // the delimiter used to segment namespaces
      delimiter: '_',
      // set this to `true` if you want to emit the newListener event
      newListener: false,
      // set this to `true` if you want to emit the removeListener event
      removeListener: false,
      // the maximum amount of listeners that can be assigned to an event
      maxListeners: 10,
      // show event name in memory leak message when more than maximum amount of listeners is assigned
      verboseMemoryLeak: false,
      // disable throwing uncaughtException if an error event is emitted and it has no listeners
      ignoreErrors: false,
    }),
  ],
})
export class AppModule {}
