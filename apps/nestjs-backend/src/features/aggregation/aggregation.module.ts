import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { DataLoaderModule } from '../data-loader/data-loader.module';
import { RecordPermissionService } from '../record/record-permission.service';
import { RecordModule } from '../record/record.module';
import { TableIndexService } from '../table/table-index.service';
import { AggregationService } from './aggregation.service';

@Module({
  imports: [RecordModule, DataLoaderModule],
  providers: [DbProvider, AggregationService, TableIndexService, RecordPermissionService],
  exports: [AggregationService],
})
export class AggregationModule {}
