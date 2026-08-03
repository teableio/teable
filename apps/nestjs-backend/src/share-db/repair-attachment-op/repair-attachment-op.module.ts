import { Module } from '@nestjs/common';
import { AttachmentsStorageModule } from '../../features/attachments/attachments-storage.module';
import { RepairAttachmentOpService } from './repair-attachment-op.service';

@Module({
  imports: [AttachmentsStorageModule],
  providers: [RepairAttachmentOpService],
  exports: [RepairAttachmentOpService],
})
export class RepairAttachmentOpModule {}
