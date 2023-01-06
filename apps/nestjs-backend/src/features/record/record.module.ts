import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { RecordService } from './record.service';

@Module({
  providers: [RecordService, PrismaService],
  exports: [RecordService],
})
export class RecordModule {}
