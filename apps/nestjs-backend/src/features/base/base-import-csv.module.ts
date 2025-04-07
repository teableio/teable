import { Module } from '@nestjs/common';
import { EventJobModule } from '../../event-emitter/event-job/event-job.module';
import { StorageModule } from '../attachments/plugins/storage.module';
import { BASE_IMPORT_CSV_QUEUE, BaseImportCsvQueueProcessor } from './base-import-csv.processor';

@Module({
  providers: [BaseImportCsvQueueProcessor],
  imports: [EventJobModule.registerQueue(BASE_IMPORT_CSV_QUEUE), StorageModule],
  exports: [BaseImportCsvQueueProcessor],
})
export class BaseImportCsvModule {}
