import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { StorageModule } from '../../attachments/plugins/storage.module';
import {
  BaseImportJunctionCsvQueueProcessor,
  BASE_IMPORT_JUNCTION_CSV_QUEUE,
} from './base-import-junction.processor';

@Module({
  providers: [BaseImportJunctionCsvQueueProcessor],
  imports: [EventJobModule.registerQueue(BASE_IMPORT_JUNCTION_CSV_QUEUE), StorageModule],
  exports: [BaseImportJunctionCsvQueueProcessor],
})
export class BaseImportJunctionCsvModule {}
