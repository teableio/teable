import { Module } from '@nestjs/common';
import { AttachmentsStorageModule } from './attachments-storage.module';
import { AttachmentsTableService } from './attachments-table.service';

@Module({
  providers: [AttachmentsTableService],
  imports: [AttachmentsStorageModule],
  exports: [AttachmentsTableService],
})
export class AttachmentsTableModule {}
