import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { RecordQueryBuilderModule } from '../record/query-builder';
import { RecordPermissionService } from '../record/record-permission.service';
import { RecordModule } from '../record/record.module';
import { TableIndexService } from '../table/table-index.service';
import { AggregationService } from './aggregation.service';

@Module({
  imports: [RecordModule, RecordQueryBuilderModule],
  providers: [DbProvider, AggregationService, TableIndexService, RecordPermissionService],
  exports: [AggregationService],
})
export class AggregationModule {}
