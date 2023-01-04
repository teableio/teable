import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ShareDbModule } from '../../share-db/share-db.module';
import { RecordCommandService } from './record-command.service';
import { RecordController } from './record.controller';
import { RecordService } from './record.service';

@Module({
  controllers: [RecordController],
  imports: [ShareDbModule],
  providers: [RecordService, PrismaService, RecordCommandService],
  exports: [RecordService],
})
export class RecordModule {}
