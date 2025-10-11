import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { conditionalQueueProcessorProviders } from '../../../utils/queue';
import { StorageModule } from '../../attachments/plugins/storage.module';
import {
  BASE_IMPORT_ATTACHMENTS_CSV_QUEUE,
  BaseImportAttachmentsCsvJob,
} from './base-import-attachments-csv.job';
import { BaseImportAttachmentsCsvQueueProcessor } from './base-import-attachments-csv.processor';
@Module({
  providers: [
    ...conditionalQueueProcessorProviders(BaseImportAttachmentsCsvQueueProcessor),
    BaseImportAttachmentsCsvJob,
  ],
  imports: [EventJobModule.registerQueue(BASE_IMPORT_ATTACHMENTS_CSV_QUEUE), StorageModule],
  exports: [BaseImportAttachmentsCsvJob],
})
export class BaseImportAttachmentsCsvModule {}
