import { Module } from '@nestjs/common';
import { EventJobModule } from '../../event-emitter/event-job/event-job.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { StorageModule } from '../attachments/plugins/storage.module';
import {
  BASE_IMPORT_ATTACHMENTS_QUEUE,
  BaseImportAttachmentsQueueProcessor,
} from './base-import-attachments.processor';

@Module({
  providers: [BaseImportAttachmentsQueueProcessor, AttachmentsModule],
  imports: [EventJobModule.registerQueue(BASE_IMPORT_ATTACHMENTS_QUEUE), StorageModule],
  exports: [BaseImportAttachmentsQueueProcessor],
})
export class BaseImportAttachmentsModule {}
