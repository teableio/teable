import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { StorageModule } from '../../attachments/plugins/storage.module';
import { BaseImportAttachmentsCsvModule } from './base-import-attachments-csv.module';
import {
  BaseImportAttachmentsCsvQueueProcessor,
  BASE_IMPORT_ATTACHMENTS_CSV_QUEUE,
} from './base-import-attachments-csv.processor';
import {
  BASE_IMPORT_ATTACHMENTS_QUEUE,
  BaseImportAttachmentsQueueProcessor,
} from './base-import-attachments.processor';
@Module({
  providers: [BaseImportAttachmentsQueueProcessor, BaseImportAttachmentsCsvQueueProcessor],
  imports: [
    EventJobModule.registerQueue(BASE_IMPORT_ATTACHMENTS_QUEUE),
    EventJobModule.registerQueue(BASE_IMPORT_ATTACHMENTS_CSV_QUEUE),
    StorageModule,
    BaseImportAttachmentsCsvModule,
  ],
  exports: [BaseImportAttachmentsQueueProcessor, BaseImportAttachmentsCsvQueueProcessor],
})
export class BaseImportAttachmentsModule {}
