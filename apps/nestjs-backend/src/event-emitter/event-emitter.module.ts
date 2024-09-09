/* eslint-disable @typescript-eslint/naming-convention */
import type { DynamicModule } from '@nestjs/common';
import { ConfigurableModuleBuilder, Module } from '@nestjs/common';
import { EventEmitterModule as BaseEventEmitterModule } from '@nestjs/event-emitter';
import { AttachmentsTableModule } from '../features/attachments/attachments-table.module';
import { NotificationModule } from '../features/notification/notification.module';
import { ShareDbModule } from '../share-db/share-db.module';
import { EventEmitterService } from './event-emitter.service';
import { ActionTriggerListener } from './listeners/action-trigger.listener';
import { AttachmentListener } from './listeners/attachment.listener';
import { BasePermissionUpdateListener } from './listeners/base-permission-update.listener';
import { CollaboratorNotificationListener } from './listeners/collaborator-notification.listener';
import { PinListener } from './listeners/pin.listener';
import { RecordHistoryListener } from './listeners/record-history.listener';
import { TrashListener } from './listeners/trash.listener';

export interface EventEmitterModuleOptions {
  global?: boolean;
}

export const { ConfigurableModuleClass: EventEmitterModuleClass, OPTIONS_TYPE } =
  new ConfigurableModuleBuilder<EventEmitterModuleOptions>().build();

@Module({})
export class EventEmitterModule extends EventEmitterModuleClass {
  static register(options?: typeof OPTIONS_TYPE): DynamicModule {
    const { global } = options || {};

    const module = BaseEventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
    });

    return {
      imports: [module, ShareDbModule, NotificationModule, AttachmentsTableModule],
      module: EventEmitterModule,
      global,
      providers: [
        EventEmitterService,
        ActionTriggerListener,
        CollaboratorNotificationListener,
        AttachmentListener,
        BasePermissionUpdateListener,
        PinListener,
        RecordHistoryListener,
        TrashListener,
      ],
      exports: [EventEmitterService],
    };
  }
}
