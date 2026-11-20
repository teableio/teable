import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { CalculationModule } from '../calculation/calculation.module';
import { FieldModule } from '../field/field.module';
import { RawOpStagingModule } from '../../share-db/raw-op-staging.module';
import { RecordModule } from '../record/record.module';
import { ViewModule } from '../view/view.module';
import { TablePermissionService } from './table-permission.service';
import { TableService } from './table.service';
import { TableSnapshotReadModule } from './table-snapshot-read.module';
@Module({
  imports: [
    CalculationModule,
    FieldModule,
    RawOpStagingModule,
    RecordModule,
    ViewModule,
    TableSnapshotReadModule,
  ],
  providers: [TableService, DbProvider, TablePermissionService],
  exports: [FieldModule, RecordModule, ViewModule, TableService, TablePermissionService],
})
export class TableModule {}
