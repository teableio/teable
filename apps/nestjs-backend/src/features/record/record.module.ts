import { Module } from '@nestjs/common';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { RecordService } from './record.service';

@Module({
  providers: [RecordService, AttachmentsTableService],
  exports: [RecordService],
})
export class RecordModule {}
