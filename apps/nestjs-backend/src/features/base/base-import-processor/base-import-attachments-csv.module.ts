import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { StorageModule } from '../../attachments/plugins/storage.module';
import {
  BaseImportAttachmentsCsvQueueProcessor,
  BASE_IMPORT_ATTACHMENTS_CSV_QUEUE,
} from './base-import-attachments-csv.processor';

@Module({
  providers: [BaseImportAttachmentsCsvQueueProcessor],
  imports: [EventJobModule.registerQueue(BASE_IMPORT_ATTACHMENTS_CSV_QUEUE), StorageModule],
  exports: [BaseImportAttachmentsCsvQueueProcessor],
})
export class BaseImportAttachmentsCsvModule {}
