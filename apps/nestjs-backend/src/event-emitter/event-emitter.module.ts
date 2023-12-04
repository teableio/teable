/* eslint-disable @typescript-eslint/naming-convention */
import type { DynamicModule } from '@nestjs/common';
import { ConfigurableModuleBuilder, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AggregationModule } from '../features/aggregation/aggregation.module';
import { FieldModule } from '../features/field/field.module';
import { NotificationModule } from '../features/notification/notification.module';
import { ShareDbModule } from '../share-db/share-db.module';
import { EventEmitterService } from './event-emitter.service';
import { AggregationListener } from './listeners/aggregation.listener';
import { NotificationListener } from './listeners/notification.listener';

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
      imports: [module, FieldModule, ShareDbModule, AggregationModule, NotificationModule],
      module: TeableEventEmitterModule,
      global,
      providers: [EventEmitterService, AggregationListener, NotificationListener],
      exports: [EventEmitterService],
    };
  }
}
