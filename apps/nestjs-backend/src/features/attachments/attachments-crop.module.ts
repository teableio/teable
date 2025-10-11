import { Module } from '@nestjs/common';
import { EventJobModule } from '../../event-emitter/event-job/event-job.module';
import { conditionalQueueProcessorProviders } from '../../utils/queue';
import { ATTACHMENTS_CROP_QUEUE, AttachmentsCropJob } from './attachments-crop.job';
import { AttachmentsCropQueueProcessor } from './attachments-crop.processor';
import { AttachmentsStorageModule } from './attachments-storage.module';

@Module({
  providers: [
    ...conditionalQueueProcessorProviders(AttachmentsCropQueueProcessor),
    AttachmentsCropJob,
  ],
  imports: [EventJobModule.registerQueue(ATTACHMENTS_CROP_QUEUE), AttachmentsStorageModule],
  exports: [AttachmentsCropJob],
})
export class AttachmentsCropModule {}
