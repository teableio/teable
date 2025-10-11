import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { conditionalQueueProcessorProviders } from '../../../utils/queue';
import { StorageModule } from '../../attachments/plugins/storage.module';
import { BASE_IMPORT_ATTACHMENTS_CSV_QUEUE } from './base-import-attachments-csv.job';
import { BaseImportAttachmentsCsvModule } from './base-import-attachments-csv.module';
import {
  BASE_IMPORT_ATTACHMENTS_QUEUE,
  BaseImportAttachmentsJob,
} from './base-import-attachments.job';
import { BaseImportAttachmentsQueueProcessor } from './base-import-attachments.processor';
@Module({
  providers: [
    ...conditionalQueueProcessorProviders(BaseImportAttachmentsQueueProcessor),
    BaseImportAttachmentsJob,
  ],
  imports: [
    EventJobModule.registerQueue(BASE_IMPORT_ATTACHMENTS_QUEUE),
    EventJobModule.registerQueue(BASE_IMPORT_ATTACHMENTS_CSV_QUEUE),
    StorageModule,
    BaseImportAttachmentsCsvModule,
  ],
  exports: [BaseImportAttachmentsJob],
})
export class BaseImportAttachmentsModule {}
