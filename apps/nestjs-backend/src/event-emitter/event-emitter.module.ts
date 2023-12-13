/* eslint-disable @typescript-eslint/naming-convention */
import type { DynamicModule } from '@nestjs/common';
import { ConfigurableModuleBuilder, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { NotificationModule } from '../features/notification/notification.module';
import { ShareDbModule } from '../share-db/share-db.module';
import { EventEmitterService } from './event-emitter.service';
import { ActionTriggerListener } from './listeners/action-trigger.listener';
import { CollaboratorNotificationListener } from './listeners/collaborator-notification.listener';

export interface EventEmitterModuleOptions {
  global?: boolean;
}

export const { ConfigurableModuleClass: EventEmitterModuleClass, OPTIONS_TYPE } =
  new ConfigurableModuleBuilder<EventEmitterModuleOptions>().build();

@Module({})
export class TeableEventEmitterModule extends EventEmitterModuleClass {
  static register(options?: typeof OPTIONS_TYPE): DynamicModule {
    const { global } = options || {};

    const module = EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
    });

    return {
      imports: [module, ShareDbModule, NotificationModule],
      module: TeableEventEmitterModule,
      global,
      providers: [EventEmitterService, ActionTriggerListener, CollaboratorNotificationListener],
      exports: [EventEmitterService],
    };
  }
}
