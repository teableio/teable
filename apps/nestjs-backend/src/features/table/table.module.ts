import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { CalculationModule } from '../calculation/calculation.module';
import { FieldModule } from '../field/field.module';
import { RecordModule } from '../record/record.module';
import { ViewModule } from '../view/view.module';
import { TableService } from './table.service';

@Module({
  imports: [CalculationModule, FieldModule, RecordModule, ViewModule],
  providers: [TableService, DbProvider],
  exports: [FieldModule, RecordModule, ViewModule, TableService],
})
export class TableModule {}
