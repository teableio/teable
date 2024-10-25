import { Module } from '@nestjs/common';
import { EventJobModule } from '../../event-emitter/event-job/event-job.module';
import { AttachmentsStorageModule } from './attachments-storage.module';
import {
  ATTACHMENTS_TABLE_QUEUE,
  AttachmentsTableQueueProcessor,
} from './attachments-table.processor';
import { AttachmentsTableService } from './attachments-table.service';

@Module({
  providers: [AttachmentsTableService, AttachmentsTableQueueProcessor],
  imports: [AttachmentsStorageModule, EventJobModule.registerQueue(ATTACHMENTS_TABLE_QUEUE)],
  exports: [AttachmentsTableService],
})
export class AttachmentsTableModule {}
