import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { RecordService } from './record.service';

@Module({
  providers: [RecordService, PrismaService, AttachmentsTableService],
  exports: [RecordService],
})
export class RecordModule {}
