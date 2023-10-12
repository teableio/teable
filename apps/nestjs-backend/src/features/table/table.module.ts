import { Module } from '@nestjs/common';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { CalculationModule } from '../calculation/calculation.module';
import { FieldModule } from '../field/field.module';
import { RecordModule } from '../record/record.module';
import { ViewModule } from '../view/view.module';
import { TableService } from './table.service';

@Module({
  imports: [CalculationModule, FieldModule, RecordModule, ViewModule],
  providers: [TableService, AttachmentsTableService],
  exports: [FieldModule, RecordModule, ViewModule, TableService],
})
export class TableModule {}
