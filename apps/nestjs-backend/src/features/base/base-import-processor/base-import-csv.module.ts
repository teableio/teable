import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { conditionalQueueProcessorProviders } from '../../../utils/queue';
import { StorageModule } from '../../attachments/plugins/storage.module';
import { BASE_IMPORT_ATTACHMENTS_CSV_QUEUE } from './base-import-attachments-csv.job';
import { BASE_IMPORT_CSV_QUEUE, BaseImportCsvJob } from './base-import-csv.job';
import { BaseImportCsvQueueProcessor } from './base-import-csv.processor';
import { BaseImportJunctionCsvModule } from './base-import-junction-csv.module';

@Module({
  providers: [BaseImportCsvJob, ...conditionalQueueProcessorProviders(BaseImportCsvQueueProcessor)],
  imports: [
    EventJobModule.registerQueue(BASE_IMPORT_CSV_QUEUE),
    EventJobModule.registerQueue(BASE_IMPORT_ATTACHMENTS_CSV_QUEUE),
    StorageModule,
    BaseImportJunctionCsvModule,
  ],
  exports: [BaseImportCsvJob],
})
export class BaseImportCsvModule {}
