import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { StorageModule } from '../../attachments/plugins/storage.module';
import { BASE_IMPORT_ATTACHMENTS_CSV_QUEUE } from './base-import-attachments-csv.processor';
import { BASE_IMPORT_CSV_QUEUE, BaseImportCsvQueueProcessor } from './base-import-csv.processor';
import { BaseImportJunctionCsvModule } from './base-import-junction-csv.module';

@Module({
  providers: [BaseImportCsvQueueProcessor],
  imports: [
    EventJobModule.registerQueue(BASE_IMPORT_CSV_QUEUE),
    EventJobModule.registerQueue(BASE_IMPORT_ATTACHMENTS_CSV_QUEUE),
    StorageModule,
    BaseImportJunctionCsvModule,
  ],
  exports: [BaseImportCsvQueueProcessor],
})
export class BaseImportCsvModule {}
