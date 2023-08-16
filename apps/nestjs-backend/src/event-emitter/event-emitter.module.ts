import type { DynamicModule } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { EventSubscribersLoader } from '@nestjs/event-emitter/dist/event-subscribers.loader';
import { EventsMetadataAccessor } from '@nestjs/event-emitter/dist/events-metadata.accessor';
import { EventEmitterService } from './event-emitter.service';

// @Global()
// @Module({
//   imports: [
//     EventEmitterModule.forRoot({
//       global: true,
//     }),
//   ],
//   providers: [EventEmitter2, EventEmitterService],
//   exports: [EventEmitter2, EventEmitterService],
// })
@Module({})
export class TeableEventEmitterModule {
  static register(): DynamicModule {
    return {
      module: TeableEventEmitterModule,
      global: true,
      imports: [
        DiscoveryModule,
        EventEmitterModule.forRoot({
          global: true,
        }),
      ],
      providers: [
        EventSubscribersLoader,
        EventsMetadataAccessor,
        EventEmitter2,
        EventEmitterService,
      ],
      exports: [EventEmitter2, EventEmitterService],
    };
  }
}
