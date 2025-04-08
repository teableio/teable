import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { CalculationModule } from '../calculation/calculation.module';
import { FieldModule } from '../field/field.module';
import { RecordModule } from '../record/record.module';
import { ViewModule } from '../view/view.module';
import { TablePermissionService } from './table-permission.service';
import { TableService } from './table.service';
@Module({
  imports: [CalculationModule, FieldModule, RecordModule, ViewModule],
  providers: [TableService, DbProvider, TablePermissionService],
  exports: [FieldModule, RecordModule, ViewModule, TableService, TablePermissionService],
})
export class TableModule {}
