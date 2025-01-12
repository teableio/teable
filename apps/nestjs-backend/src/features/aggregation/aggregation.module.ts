import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { RecordModule } from '../record/record.module';
import { TableFullTextService } from '../table/full-text-search.service';
import { AggregationService } from './aggregation.service';

@Module({
  imports: [RecordModule],
  providers: [DbProvider, AggregationService, TableFullTextService],
  exports: [AggregationService],
})
export class AggregationModule {}
