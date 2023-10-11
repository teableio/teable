import { Module } from '@nestjs/common';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { CalculationModule } from '../calculation/calculation.module';
import { RecordService } from './record.service';

@Module({
  imports: [CalculationModule],
  providers: [RecordService, AttachmentsTableService],
  exports: [RecordService],
})
export class RecordModule {}
