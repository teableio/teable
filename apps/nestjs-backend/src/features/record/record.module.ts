import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { RecordController } from './record.controller';
import { RecordService } from './record.service';

@Module({
  controllers: [RecordController],
  providers: [RecordService, PrismaService],
  exports: [RecordService],
})
export class RecordModule {}
