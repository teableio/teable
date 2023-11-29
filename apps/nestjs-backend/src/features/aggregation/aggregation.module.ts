import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AggregationService } from './aggregation.service';

@Module({
  imports: [],
  providers: [DbProvider, AggregationService],
  exports: [AggregationService],
})
export class AggregationModule {}
