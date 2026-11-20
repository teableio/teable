import { Module } from '@nestjs/common';
import { AttachmentCellValueService } from './attachment-cell-value.service';
import { AttachmentsStorageModule } from './attachments-storage.module';

@Module({
  imports: [AttachmentsStorageModule],
  providers: [AttachmentCellValueService],
  exports: [AttachmentCellValueService],
})
export class AttachmentCellValueModule {}
