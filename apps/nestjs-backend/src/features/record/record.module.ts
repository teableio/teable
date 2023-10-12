import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { CalculationModule } from '../calculation/calculation.module';
import { RecordService } from './record.service';

@Module({
  imports: [CalculationModule],
  providers: [RecordService, AttachmentsTableService, DbProvider],
  exports: [RecordService],
})
export class RecordModule {}
