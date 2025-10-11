import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { conditionalQueueProcessorProviders } from '../../../utils/queue';
import { StorageModule } from '../../attachments/plugins/storage.module';
import {
  BASE_IMPORT_JUNCTION_CSV_QUEUE,
  BaseImportJunctionCsvJob,
} from './base-import-junction.job';
import { BaseImportJunctionCsvQueueProcessor } from './base-import-junction.processor';

@Module({
  providers: [
    ...conditionalQueueProcessorProviders(BaseImportJunctionCsvQueueProcessor),
    BaseImportJunctionCsvJob,
  ],
  imports: [EventJobModule.registerQueue(BASE_IMPORT_JUNCTION_CSV_QUEUE), StorageModule],
  exports: [BaseImportJunctionCsvJob],
})
export class BaseImportJunctionCsvModule {}
