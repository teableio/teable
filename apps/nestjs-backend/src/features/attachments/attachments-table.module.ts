import { Module } from '@nestjs/common';
import { AttachmentsTableService } from './attachments-table.service';

@Module({
  providers: [AttachmentsTableService],
  imports: [],
  exports: [AttachmentsTableService],
})
export class AttachmentsTableModule {}
