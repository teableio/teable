import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { DevtoolsModule } from '@nestjs/devtools-integration';
import { EventEmitterModule } from '@nestjs/event-emitter';
import type { IAppConfig } from './app.interface';
import { AttachmentsModule } from './features/attachments/attachments.module';
import { AutomationModule } from './features/automation/automation.module';
import { ChatModule } from './features/chat/chat.module';
import { FileTreeModule } from './features/file-tree/file-tree.module';
import { NextModule } from './features/next/next.module';
import { TableOpenApiModule } from './features/table/open-api/table-open-api.module';
import { WsModule } from './ws/ws.module';

@Module({})
export class AppModule {
  static forRoot(config: IAppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DevtoolsModule.register({
          http: process.env.NODE_ENV !== 'production',
        }),
        NextModule.forRoot(config),
        FileTreeModule,
        TableOpenApiModule,
        ChatModule,
        AttachmentsModule,
        AutomationModule,
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
        ...(process.env.NODE_ENV !== 'production' ? [WsModule] : []),
      ],
    };
  }
}
