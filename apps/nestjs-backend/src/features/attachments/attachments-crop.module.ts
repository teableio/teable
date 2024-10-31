import { Module } from '@nestjs/common';
import { EventJobModule } from '../../event-emitter/event-job/event-job.module';
import {
  ATTACHMENTS_CROP_QUEUE,
  AttachmentsCropQueueProcessor,
} from './attachments-crop.processor';
import { AttachmentsStorageModule } from './attachments-storage.module';

@Module({
  providers: [AttachmentsCropQueueProcessor],
  imports: [EventJobModule.registerQueue(ATTACHMENTS_CROP_QUEUE), AttachmentsStorageModule],
  exports: [AttachmentsCropQueueProcessor],
})
export class AttachmentsCropModule {}
