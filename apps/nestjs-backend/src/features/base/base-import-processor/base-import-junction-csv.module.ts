import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { StorageModule } from '../../attachments/plugins/storage.module';
import { NotificationModule } from '../../notification/notification.module';
import { ComputedModule } from '../../record/computed/computed.module';
import { BaseImportComputedModule } from '../base-import-computed.module';
import {
  BaseImportJunctionCsvQueueProcessor,
  BASE_IMPORT_JUNCTION_CSV_QUEUE,
} from './base-import-junction.processor';

@Module({
  providers: [BaseImportJunctionCsvQueueProcessor],
  imports: [
    EventJobModule.registerQueue(BASE_IMPORT_JUNCTION_CSV_QUEUE),
    StorageModule,
    ComputedModule,
    BaseImportComputedModule,
    NotificationModule,
  ],
  exports: [BaseImportJunctionCsvQueueProcessor],
})
export class BaseImportJunctionCsvModule {}
